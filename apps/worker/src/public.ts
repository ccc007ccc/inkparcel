import { iconUrl, defaultIcon } from './site-icon';
import { Hono } from 'hono';
import { accessCode, decode, decryptSecret, encode, passwordVerifier } from './crypto';
import { clearCookie, issueCookie, rateLimit, recipientSession, secretMatches } from './auth';
import { now, publicFile, publicFolder } from './db';
import { downloadRoutes } from './downloads';
import type { Bindings, FileRow, FolderRow, KeyRow, UserRow } from './types';
import {
  adminPath,
  body,
  fail,
  fields,
  like,
  nullableId,
  pagination,
  text,
  userId,
} from './validation';

export const publicApi = new Hono<Bindings>();
publicApi.get('/site', (c) =>
  c.json({
    name: c.get('settings')?.site_name || 'InkParcel',
    initialized: !!c.get('settings'),
    stealthMode: !!c.get('settings')?.stealth_mode,
    iconUrl: iconUrl(c.get('settings')?.icon_version),
  }),
);
publicApi.on(['GET', 'HEAD'], '/site-icon', async (c) => {
  const version = c.get('settings')?.icon_version;
  if (version) {
    const icon = await c.env.DB.prepare('SELECT bytes FROM site_icon WHERE id = 1 AND version = ?')
      .bind(version)
      .first<{ bytes: number[] }>();
    if (icon)
      return new Response(c.req.method === 'HEAD' ? null : new Uint8Array(icon.bytes), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
  }
  return new Response(c.req.method === 'HEAD' ? null : defaultIcon, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
publicApi.get('/setup', (c) => {
  if (c.get('settings')) fail(404, 'not_found', '页面不存在');
  return c.json({ available: true });
});
publicApi.post('/setup', async (c) => {
  if (c.get('settings')) fail(404, 'not_found', '页面不存在');
  await rateLimit(c, 'setup', 10);
  const input = await body(c);
  fields(input, ['bootstrapToken', 'passwordKey', 'passwordSalt', 'adminPath']);
  if (!c.env.BOOTSTRAP_TOKEN) fail(503, 'bootstrap_unconfigured', '请先配置初始化令牌');
  const bootstrapToken = text(input.bootstrapToken, '初始化令牌', 256);
  if (!secretMatches(bootstrapToken, c.env.BOOTSTRAP_TOKEN))
    fail(403, 'invalid_bootstrap_token', '初始化令牌错误');
  const path = adminPath(input.adminPath);
  const salt = encode(decode(input.passwordSalt, 16, 64));
  const verifier = await passwordVerifier(c.env, input.passwordKey);
  const result = await c.env.DB.prepare(
    `INSERT INTO settings (id, admin_path, password_verifier, password_salt, created_at)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(path, verifier, salt, now())
    .run();
  if (!result.meta.changes) fail(409, 'already_initialized', '站点已完成初始化');
  await issueCookie(c, 'admin', { ver: 1 });
  return c.json({ adminPath: path }, 201);
});
publicApi.post('/access', async (c) => {
  if (!c.get('settings')) fail(503, 'setup_required', '站点尚未初始化');
  await rateLimit(c, 'access-ip', 60);
  const input = await body(c);
  fields(input, ['userId', 'code']);
  const subject = userId(input.userId);
  await rateLimit(c, 'access-user', 30, subject);
  const code = text(input.code, '提取码', 80);
  const match = /^([0-9a-f]{8})\.([A-Za-z0-9_-]{22})$/.exec(code);
  if (!match) fail(401, 'invalid_access', '用户 ID 或提取码错误');
  const key = await c.env.DB.prepare(
    'SELECT * FROM keys WHERE code = ? AND enabled = 1 AND deleted = 0',
  )
    .bind(match[1])
    .first<KeyRow>();
  if (!key) fail(401, 'invalid_access', '用户 ID 或提取码错误');
  const expected = await accessCode(
    await decryptSecret(c.env, key.secret_encrypted),
    key.id,
    key.code,
    subject,
  );
  if (!secretMatches(code, expected)) fail(401, 'invalid_access', '用户 ID 或提取码错误');
  const timestamp = now();
  const user = await c.env.DB.prepare(
    `INSERT INTO users (id, user_id, first_seen_at, last_seen_at)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM keys WHERE id = ? AND enabled = 1 AND deleted = 0)
    ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at WHERE blocked = 0 AND deleted = 0 RETURNING *`,
  )
    .bind(crypto.randomUUID(), subject, timestamp, timestamp, key.id)
    .first<UserRow>();
  if (!user || user.blocked) fail(403, 'access_revoked', '用户或密钥已停用');
  await issueCookie(c, 'recipient', { uid: user.id, kid: key.id });
  return c.json({
    user: { id: user.id, userId: user.user_id },
    key: { id: key.id, name: key.name },
  });
});
publicApi.post('/logout', (c) => {
  clearCookie(c, 'recipient');
  return c.json({ ok: true });
});
publicApi.use('*', async (c, next) => {
  await recipientSession(c);
  await next();
});
publicApi.get('/session', (c) =>
  c.json({
    user: { id: c.get('user').id, userId: c.get('user').user_id },
    key: { id: c.get('key').id, name: c.get('key').name },
  }),
);
publicApi.get('/files', async (c) => {
  const { page, pageSize, offset } = pagination(c);
  const folderId = nullableId(c.req.query('folderId'));
  const key = c.get('key').id;
  const visible = await c.env.DB.prepare(
    `WITH RECURSIVE visible(id) AS (
    SELECT DISTINCT f.folder_id FROM files f JOIN file_keys fk ON fk.file_id = f.id WHERE f.status = 'ready' AND fk.key_id = ? AND f.folder_id IS NOT NULL
    UNION SELECT f.parent_id FROM folders f JOIN visible v ON v.id = f.id WHERE f.parent_id IS NOT NULL)
    SELECT f.* FROM folders f JOIN visible v ON v.id = f.id ORDER BY f.name, f.id`,
  )
    .bind(key)
    .all<FolderRow>();
  if (folderId && !visible.results.some((f) => f.id === folderId))
    fail(404, 'folder_not_found', '文件夹不存在或无权访问');
  const breadcrumbs: FolderRow[] = [];
  let ancestor = folderId;
  while (ancestor) {
    const folder = visible.results.find((f) => f.id === ancestor);
    if (!folder) break;
    breadcrumbs.unshift(folder);
    ancestor = folder.parent_id;
  }
  const [files, count] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT f.* FROM files f JOIN file_keys fk ON f.id = fk.file_id WHERE f.status = 'ready' AND fk.key_id = ? AND f.folder_id IS ? ORDER BY f.uploaded_at DESC, f.id LIMIT ? OFFSET ?`,
    ).bind(key, folderId, pageSize, offset),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM files f JOIN file_keys fk ON f.id = fk.file_id WHERE f.status = 'ready' AND fk.key_id = ? AND f.folder_id IS ?`,
    ).bind(key, folderId),
  ]);
  return c.json({
    files: (files.results as unknown as FileRow[]).map(publicFile),
    folders: visible.results.filter((f) => f.parent_id === folderId).map(publicFolder),
    breadcrumbs: breadcrumbs.map(publicFolder),
    total: (count.results[0] as { n: number }).n,
    page,
    pageSize,
  });
});
publicApi.route('/', downloadRoutes);

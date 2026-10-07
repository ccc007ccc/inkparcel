import { Hono } from 'hono';
import { accessCode, decode, decryptSecret, encode, encryptSecret, keyedValue, passwordVerifier, readMarker, verifyMarker } from './crypto';
import { adminSession, clearCookie, issueCookie, rateLimit, secretMatches } from './auth';
import { downloadObject, fileObject, fileObjects, folderObject, folderObjects, keyObject, now, requireFile, requireFolder, requireKeys, settings, userObject } from './db';
import type { Bindings, DownloadRow, FileRow, FolderRow, KeyRow, UserRow } from './types';
import { adminPath, body, boolean, fail, fields, id, integer, keyIds, like, name, nullableId, pagination, query, text, userId } from './validation';
import { uploadRoutes } from './uploads';

export const admin = new Hono<Bindings>();
admin.use('*', async (c, next) => { c.set('settings', await settings(c.env.DB)); await next(); });
admin.get('/auth', async c => c.json({ authenticated: !!await adminSession(c, false), passwordSalt: c.get('settings')!.password_salt, kdf: { algorithm: 'PBKDF2-SHA256', iterations: 600000 } }));
admin.post('/login', async c => {
  await rateLimit(c, 'admin-login', 20);
  const input = await body(c); fields(input, ['passwordKey']);
  const config = c.get('settings')!;
  if (!secretMatches(await passwordVerifier(c.env, input.passwordKey), config.password_verifier)) fail(401, 'invalid_password', '密码错误');
  await issueCookie(c, 'admin', { ver: config.auth_version }); return c.json({ ok: true });
});
admin.use('*', async (c, next) => { await adminSession(c); await next(); });
admin.post('/logout', c => { clearCookie(c, 'admin'); return c.json({ ok: true }); });
admin.get('/keys', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM keys ORDER BY created_at DESC, id').all<KeyRow>(); return c.json({ items: rows.results.map(keyObject) });
});
admin.post('/keys', async c => {
  const input = await body(c); fields(input, ['name', 'secret']); const displayName = text(input.name, '密钥名称');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM keys').first<{n: number}>();
  if (count!.n >= 100) fail(409, 'key_limit', '最多支持 100 把密钥');
  const secret = input.secret === undefined ? crypto.getRandomValues(new Uint8Array(32)) : decode(input.secret, 32, 32);
  const digest = await keyedValue(c.env, 'secret-digest', encode(secret));
  if (await c.env.DB.prepare('SELECT id FROM keys WHERE secret_digest = ?').bind(digest).first()) fail(409, 'duplicate_secret', '该密钥已存在');
  const keyId = crypto.randomUUID(); const code = crypto.randomUUID().slice(0, 8); const created = now();
  const encrypted = await encryptSecret(c.env, secret);
  await c.env.DB.prepare('INSERT INTO keys (id, code, name, secret_encrypted, secret_digest, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(keyId, code, displayName, encrypted, digest, created).run();
  return c.json({ key: { id: keyId, code, name: displayName, enabled: true, createdAt: created }, secret: encode(secret) }, 201);
});
admin.patch('/keys/:id', async c => {
  const input = await body(c); fields(input, ['name', 'enabled']);
  const row = await c.env.DB.prepare('SELECT * FROM keys WHERE id = ?').bind(id(c.req.param('id'))).first<KeyRow>();
  if (!row) fail(404, 'key_not_found', '密钥不存在');
  const displayName = input.name === undefined ? row.name : text(input.name, '密钥名称');
  const enabled = input.enabled === undefined ? row.enabled : Number(boolean(input.enabled));
  const updated = await c.env.DB.prepare('UPDATE keys SET name = ?, enabled = ? WHERE id = ? RETURNING *').bind(displayName, enabled, row.id).first<KeyRow>();
  return c.json({ key: keyObject(updated!) });
});
admin.post('/keys/:id/code', async c => {
  const input = await body(c); fields(input, ['userId']); const subject = userId(input.userId);
  const row = await c.env.DB.prepare('SELECT * FROM keys WHERE id = ?').bind(id(c.req.param('id'))).first<KeyRow>();
  if (!row || !row.enabled) fail(409, 'key_unavailable', '密钥不存在或已停用');
  return c.json({ userId: subject, code: await accessCode(await decryptSecret(c.env, row.secret_encrypted), row.id, row.code, subject) });
});
admin.get('/folders', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM folders ORDER BY name, id').all<FolderRow>(); return c.json({ items: await folderObjects(c.env.DB, rows.results) });
});
admin.post('/folders', async c => {
  const input = await body(c); fields(input, ['name', 'parentId', 'defaultKeyIds']);
  const folderName = name(input.name); const parent = nullableId(input.parentId); const keys = keyIds(input.defaultKeyIds ?? []);
  await Promise.all([requireFolder(c.env.DB, parent), requireKeys(c.env.DB, keys)]);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM folders').first<{n: number}>();
  if (count!.n >= 1000) fail(409, 'folder_limit', '最多支持 1000 个文件夹');
  const folderId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)').bind(folderId, folderName, parent, now()),
    ...keys.map(key => c.env.DB.prepare('INSERT INTO folder_keys (folder_id, key_id) VALUES (?, ?)').bind(folderId, key))
  ]);
  return c.json({ folder: { id: folderId, name: folderName, parentId: parent, defaultKeyIds: keys } }, 201);
});
admin.patch('/folders/:id', async c => {
  const input = await body(c); fields(input, ['name', 'parentId', 'defaultKeyIds']);
  const row = (await requireFolder(c.env.DB, id(c.req.param('id'))))!;
  const folderName = input.name === undefined ? row.name : name(input.name);
  const parent = input.parentId === undefined ? row.parent_id : nullableId(input.parentId);
  const keys = input.defaultKeyIds === undefined ? undefined : keyIds(input.defaultKeyIds);
  await requireFolder(c.env.DB, parent); if (keys) await requireKeys(c.env.DB, keys);
  // The recursive check runs in the same SQLite write statement, so simultaneous moves cannot create a cycle.
  const statements = [c.env.DB.prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM folders WHERE id = ? UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id)
    UPDATE folders SET name = ?, parent_id = ? WHERE id = ? AND (? IS NULL OR ? NOT IN (SELECT id FROM descendants)) RETURNING *`).bind(row.id, folderName, parent, row.id, parent, parent)];
  // Defaults do not change file ACLs. A cycle failure must not change defaults either.
  if (keys) {
    statements.push(c.env.DB.prepare('DELETE FROM folder_keys WHERE folder_id = ? AND (SELECT name = ? AND parent_id IS ? FROM folders WHERE id = ?)').bind(row.id, folderName, parent, row.id));
    for (const key of keys) statements.push(c.env.DB.prepare('INSERT INTO folder_keys (folder_id, key_id) SELECT ?, ? WHERE (SELECT name = ? AND parent_id IS ? FROM folders WHERE id = ?)').bind(row.id, key, folderName, parent, row.id));
  }
  const result = await c.env.DB.batch<FolderRow>(statements);
  if (!result[0].results.length) fail(409, 'folder_cycle', '不能将文件夹移动到自身或子文件夹');
  return c.json({ folder: await folderObject(c.env.DB, result[0].results[0]) });
});
admin.delete('/folders/:id', async c => {
  const folderId = id(c.req.param('id')); await requireFolder(c.env.DB, folderId);
  // Deleted provenance rows retain the name snapshot but must not prevent organizing live folders.
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE files SET folder_id = NULL WHERE folder_id = ? AND status = 'deleted'").bind(folderId),
    c.env.DB.prepare('DELETE FROM folders WHERE id = ? AND NOT EXISTS (SELECT 1 FROM folders WHERE parent_id = ?) AND NOT EXISTS (SELECT 1 FROM files WHERE folder_id = ?)').bind(folderId, folderId, folderId)
  ]);
  if (!result[1].meta.changes) fail(409, 'folder_not_empty', '只能删除空文件夹'); return c.json({ ok: true });
});
admin.get('/files', async c => {
  const { page, pageSize, offset } = pagination(c); const search = query(c); const folder = nullableId(c.req.query('folderId'));
  await requireFolder(c.env.DB, folder);
  const conditions = ["status <> 'deleted'"]; const args: (string | null)[] = [];
  if (search) { conditions.push("name LIKE ? ESCAPE '\\'"); args.push(like(search)); } else { conditions.push('folder_id IS ?'); args.push(folder); }
  const where = conditions.join(' AND ');
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM files WHERE ${where} ORDER BY uploaded_at DESC, id LIMIT ? OFFSET ?`).bind(...args, pageSize, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM files WHERE ${where}`).bind(...args)
  ]);
  return c.json({ files: await fileObjects(c.env.DB, rows.results as unknown as FileRow[]), total: (count.results[0] as {n: number}).n, page, pageSize });
});
admin.patch('/files/:id', async c => {
  const input = await body(c); fields(input, ['name', 'folderId', 'keyIds']); const row = await requireFile(c.env.DB, id(c.req.param('id')));
  if (row.status === 'deleted') fail(409, 'file_deleted', '文件已删除');
  const displayName = input.name === undefined ? row.name : name(input.name);
  const folder = input.folderId === undefined ? row.folder_id : nullableId(input.folderId);
  const keys = input.keyIds === undefined ? undefined : keyIds(input.keyIds);
  await requireFolder(c.env.DB, folder); if (keys) await requireKeys(c.env.DB, keys);
  const statements = [c.env.DB.prepare('UPDATE files SET name = ?, folder_id = ? WHERE id = ?').bind(displayName, folder, row.id)];
  if (keys) { statements.push(c.env.DB.prepare('DELETE FROM file_keys WHERE file_id = ?').bind(row.id)); for (const key of keys) statements.push(c.env.DB.prepare('INSERT INTO file_keys (file_id, key_id) VALUES (?, ?)').bind(row.id, key)); }
  await c.env.DB.batch(statements); return c.json({ file: await fileObject(c.env.DB, await requireFile(c.env.DB, row.id)) });
});
admin.delete('/files/:id', async c => {
  const row = await requireFile(c.env.DB, id(c.req.param('id')));
  if (row.status === 'pending') fail(409, 'upload_pending', '请先中止上传');
  await c.env.DB.prepare("UPDATE files SET status = 'deleted' WHERE id = ?").bind(row.id).run();
  // Metadata is retired before deleting bytes so a retry cannot expose a removed version.
  await c.env.BUCKET.delete(row.object_key);
  await c.env.DB.prepare('UPDATE files SET object_deleted = 1 WHERE id = ?').bind(row.id).run(); return c.json({ ok: true });
});
admin.get('/users', async c => {
  const { page, pageSize, offset } = pagination(c); const search = like(query(c));
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM users WHERE user_id LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' ORDER BY last_seen_at DESC, id LIMIT ? OFFSET ?").bind(search, search, pageSize, offset),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE user_id LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\'").bind(search, search)
  ]);
  return c.json({ items: (rows.results as unknown as UserRow[]).map(userObject), total: (count.results[0] as {n: number}).n, page, pageSize });
});
admin.patch('/users/:id', async c => {
  const input = await body(c); fields(input, ['notes', 'blocked']);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id(c.req.param('id'))).first<UserRow>(); if (!row) fail(404, 'user_not_found', '用户不存在');
  const notes = input.notes === undefined ? row.notes : text(input.notes, '备注', 2000, true); const blocked = input.blocked === undefined ? row.blocked : Number(boolean(input.blocked));
  const updated = await c.env.DB.prepare('UPDATE users SET notes = ?, blocked = ? WHERE id = ? RETURNING *').bind(notes, blocked, row.id).first<UserRow>(); return c.json({ user: userObject(updated!) });
});
admin.get('/downloads', async c => {
  const { page, pageSize, offset } = pagination(c); const search = query(c); const conditions = ['1 = 1']; const args: string[] = [];
  for (const [param, column] of [['userId', 'user_id'], ['keyId', 'key_id'], ['fileId', 'file_id']]) if (c.req.query(param)) { conditions.push(`d.${column} = ?`); args.push(id(c.req.query(param))); }
  if (search) { conditions.push("(u.user_id LIKE ? ESCAPE '\\' OR d.signed_name LIKE ? ESCAPE '\\')"); args.push(like(search), like(search)); }
  const from = `FROM downloads d JOIN users u ON d.user_id = u.id JOIN keys k ON d.key_id = k.id WHERE ${conditions.join(' AND ')}`;
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT d.*, u.user_id AS user_name, k.name AS key_name ${from} ORDER BY d.created_at DESC, d.id LIMIT ? OFFSET ?`).bind(...args, pageSize, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...args)
  ]);
  return c.json({ items: (rows.results as unknown as DownloadRow[]).map(downloadObject), total: (count.results[0] as {n: number}).n, page, pageSize });
});
admin.post('/trace', async c => {
  const input = await body(c); fields(input, ['marker', 'fingerprint']);
  if (input.fingerprint !== undefined && (typeof input.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(input.fingerprint))) fail(400, 'invalid_fingerprint', '文件指纹无效');
  const marker = readMarker(input.marker);
  const key = await c.env.DB.prepare('SELECT * FROM keys WHERE id = ?').bind(marker.claims.keyId).first<KeyRow>();
  if (!key || !await verifyMarker(await decryptSecret(c.env, key.secret_encrypted), marker)) fail(422, 'invalid_marker_authentication', '标记认证失败');
  const record = await c.env.DB.prepare('SELECT * FROM downloads WHERE id = ?').bind(marker.claims.issuanceId).first<DownloadRow>();
  if (!record || !secretMatches(record.marker, input.marker as string)) fail(422, 'issuance_not_found', '标记认证成功，但签发记录缺失或不匹配');
  const [user, file] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(record.user_id).first<UserRow>(), requireFile(c.env.DB, record.file_id)
  ]);
  return c.json({ authentic: true, contentMatch: input.fingerprint === undefined ? null : input.fingerprint === marker.claims.fingerprint,
    record: downloadObject({ ...record, user_name: user!.user_id, key_name: key.name }), user: userObject(user!), key: keyObject(key), file: await fileObject(c.env.DB, file), signedName: marker.claims.name });
});
admin.get('/settings', c => { const s = c.get('settings')!; return c.json({ siteName: s.site_name, adminPath: s.admin_path, ipRetentionDays: s.ip_retention_days }); });
admin.patch('/settings', async c => {
  const input = await body(c); fields(input, ['siteName', 'adminPath', 'ipRetentionDays']); const current = c.get('settings')!;
  const siteName = input.siteName === undefined ? current.site_name : text(input.siteName, '站点名称', 80);
  const path = input.adminPath === undefined ? current.admin_path : adminPath(input.adminPath);
  const retention = input.ipRetentionDays === undefined ? current.ip_retention_days : integer(input.ipRetentionDays, 0, 3650);
  await c.env.DB.prepare('UPDATE settings SET site_name = ?, admin_path = ?, ip_retention_days = ? WHERE id = 1').bind(siteName, path, retention).run();
  if (retention === 0) await c.env.DB.prepare('UPDATE downloads SET ip = NULL WHERE ip IS NOT NULL').run();
  return c.json({ siteName, adminPath: path, ipRetentionDays: retention });
});
admin.post('/password', async c => {
  await rateLimit(c, 'password-change', 20);
  const input = await body(c); fields(input, ['currentPasswordKey', 'passwordKey', 'passwordSalt']);
  const current = c.get('settings')!;
  if (!secretMatches(await passwordVerifier(c.env, input.currentPasswordKey), current.password_verifier)) fail(401, 'invalid_password', '当前密码错误');
  const salt = encode(decode(input.passwordSalt, 16, 64)); const verifier = await passwordVerifier(c.env, input.passwordKey);
  const updated = await c.env.DB.prepare('UPDATE settings SET password_salt = ?, password_verifier = ?, auth_version = auth_version + 1 WHERE id = 1 AND auth_version = ? RETURNING auth_version').bind(salt, verifier, current.auth_version).first<{auth_version: number}>();
  if (!updated) fail(409, 'settings_changed', '管理凭证已更新，请重新登录');
  clearCookie(c, 'admin'); return c.json({ ok: true });
});
admin.route('/uploads', uploadRoutes);

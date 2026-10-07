import { getCookie, setCookie } from 'hono/cookie';
import { equal, keyedValue, parseSession, signSession, utf8 } from './crypto';
import type { Ctx, KeyRow, Session, UserRow } from './types';
import { fail } from './validation';

const names = { admin: 'inkparcel_admin', recipient: 'inkparcel_recipient' };
const secure = (c: Ctx) =>
  !(
    c.env.ENVIRONMENT === 'local' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)
  );
export async function issueCookie(
  c: Ctx,
  kind: Session['kind'],
  data: Pick<Session, 'ver' | 'uid' | 'kid'> = {},
) {
  const ttl = kind === 'admin' ? 8 * 3600 : 24 * 3600;
  const session: Session = {
    kind,
    exp: Math.floor(Date.now() / 1000) + ttl,
    sid: crypto.randomUUID(),
    ...data,
  };
  setCookie(c, names[kind], await signSession(c.env, session), {
    path: '/',
    httpOnly: true,
    secure: secure(c),
    sameSite: 'Strict',
    maxAge: ttl,
  });
  return session;
}
export function clearCookie(c: Ctx, kind: Session['kind']) {
  setCookie(c, names[kind], '', {
    path: '/',
    httpOnly: true,
    secure: secure(c),
    sameSite: 'Strict',
    maxAge: 0,
  });
}
export async function adminSession(c: Ctx, required = true) {
  const session = await parseSession(c.env, getCookie(c, names.admin));
  const settings = c.get('settings');
  if (!settings || !session || session.kind !== 'admin' || session.ver !== settings.auth_version) {
    if (required) fail(401, 'admin_auth_required', '请登录管理后台');
    return null;
  }
  c.set('session', session);
  return session;
}
export async function recipientSession(c: Ctx) {
  const session = await parseSession(c.env, getCookie(c, names.recipient));
  if (!session || session.kind !== 'recipient' || !session.uid || !session.kid)
    fail(401, 'auth_required', '请先输入用户 ID 和提取码');
  const [user, key] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.uid).first<UserRow>(),
    c.env.DB.prepare('SELECT * FROM keys WHERE id = ?').bind(session.kid).first<KeyRow>(),
  ]);
  if (!user || user.deleted || user.blocked || !key || key.deleted || !key.enabled)
    fail(401, 'access_revoked', '访问权限已停用');
  c.set('session', session);
  c.set('user', user);
  c.set('key', key);
  return { user: { id: user.id, userId: user.user_id }, key: { id: key.id, name: key.name } };
}
export async function rateLimit(c: Ctx, scope: string, limit: number, subject?: string) {
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  const value = `${scope}:${subject ?? ip}`;
  const bucket = await keyedValue(c.env, 'rate-limit', value);
  const window = Math.floor(Date.now() / (15 * 60 * 1000)) * 900;
  const result = await c.env.DB.prepare(
    `INSERT INTO rate_limits (id, window_start, hits) VALUES (?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
    window_start = excluded.window_start RETURNING hits`,
  )
    .bind(bucket, window)
    .first<{ hits: number }>();
  if (!result || result.hits > limit) {
    c.header('Retry-After', '900');
    fail(429, 'rate_limited', '尝试次数过多，请稍后重试');
  }
}
export function secretMatches(a: string, b: string) {
  return equal(utf8(a), utf8(b));
}

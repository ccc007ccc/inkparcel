import { Hono } from 'hono';
import { admin } from './admin';
import { cleanup } from './cleanup';
import { settings } from './db';
import { publicApi } from './public';
import type { Bindings, Env } from './types';
import { ApiError, assertOrigin, fail } from './validation';

export const app = new Hono<Bindings>();
const notFound = () =>
  new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
function errorResponse(error: Error, c: Parameters<Parameters<typeof app.onError>[0]>[1]) {
  if (error instanceof ApiError)
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
  if (/UNIQUE constraint failed/i.test(error.message))
    return c.json({ error: { code: 'conflict', message: '名称或记录已存在' } }, 409);
  if (/FOREIGN KEY constraint failed/i.test(error.message))
    return c.json(
      { error: { code: 'reference_changed', message: '关联记录已改变，请刷新后重试' } },
      409,
    );
  // Do not log request bodies, credentials, markers or raw SQL bindings.
  console.error('InkParcel request failed', error.name);
  return c.json({ error: { code: 'internal_error', message: '请求未完成，请稍后重试' } }, 500);
}
app.onError(errorResponse);
admin.onError(errorResponse);
app.notFound(notFound);
admin.notFound(notFound);
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const local =
    c.env.ENVIRONMENT === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    if (url.protocol === 'http:' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      url.protocol = 'https:';
      return new Response(null, {
        status: 308,
        headers: { Location: url.toString(), 'Cache-Control': 'no-store' },
      });
    }
    fail(400, 'https_required', '请使用 HTTPS 连接');
  }
  const pathname = url.pathname;
  if (pathname.includes('%') || pathname.includes('\\') || pathname.includes('//'))
    return notFound();
  assertOrigin(c);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cache-Control', 'no-store');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (!local) c.header('Strict-Transport-Security', 'max-age=31536000');
  c.set('settings', await settings(c.env.DB));
  await next();
});
app.route('/api', publicApi);
app.all('*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const current = c.get('settings');
  if (current && path.startsWith(`${current.admin_path}/api/`)) {
    const url = new URL(c.req.url);
    url.pathname = path.slice(current.admin_path.length + 4);
    return admin.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
  }
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return notFound();
  const page =
    path === '/' ||
    (!current && path === '/admin') ||
    (current && (path === current.admin_path || path === `${current.admin_path}/`));
  if (page) {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    url.search = '';
    const result = await c.env.ASSETS.fetch(new Request(url, { method: c.req.method }));
    if (result.status !== 200) fail(503, 'assets_unavailable', '网页资源尚未构建');
    const response = new Response(result.body, result);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (
    /^\/assets\/[A-Za-z0-9_.-]+$/.test(path) ||
    ['/favicon.svg', '/favicon.ico', '/robots.txt'].includes(path)
  ) {
    const result = await c.env.ASSETS.fetch(c.req.raw);
    // A missing static asset must not turn into an SPA fallback.
    if (result.status === 404 || (result.headers.get('Content-Type') || '').includes('text/html'))
      return notFound();
    return result;
  }
  return notFound();
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await cleanup(env);
  },
} satisfies ExportedHandler<Env>;

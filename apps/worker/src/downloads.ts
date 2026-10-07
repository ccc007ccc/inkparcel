import { handlerFor } from '@inkparcel/marking';
import { Hono } from 'hono';
import { decryptSecret, signMarker, utf8 } from './crypto';
import { authorizedFile, now } from './db';
import { r2Source } from './source';
import type { Bindings, DownloadRow } from './types';
import { body, fail, fields, id } from './validation';

export const downloadRoutes = new Hono<Bindings>();
export function parseRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : undefined; const end = match[2] ? Number(match[2]) : undefined;
  if ((start !== undefined && !Number.isSafeInteger(start)) || (end !== undefined && !Number.isSafeInteger(end))) return null;
  if (start === undefined) {
    if (!end || end < 1) return null;
    const length = Math.min(end, size); return { offset: size - length, length };
  }
  if (start >= size || (end !== undefined && end < start)) return null;
  return { offset: start, length: Math.min(end ?? size - 1, size - 1) - start + 1 };
}
function disposition(name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
downloadRoutes.post('/files/:id/downloads', async c => {
  const input = await body(c); fields(input, []);
  const file = await authorizedFile(c, id(c.req.param('id'))); const user = c.get('user'); const key = c.get('key');
  const issuanceId = crypto.randomUUID(); const issuedAt = now();
  const marker = await signMarker(await decryptSecret(c.env, key.secret_encrypted), {
    v: 1, issuanceId, userId: user.id, keyId: key.id, fileId: file.id,
    fingerprint: file.fingerprint, name: file.name, issuedAt
  });
  const ip = c.get('settings')!.ip_retention_days > 0 ? (c.req.header('CF-Connecting-IP') || null) : null;
  // The INSERT checks current authorization again: revocation during marker generation cannot sign a new usable grant.
  const result = await c.env.DB.prepare(`INSERT INTO downloads (id, user_id, key_id, file_id, signed_name, marker, created_at, ip)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND blocked = 0)
    AND EXISTS (SELECT 1 FROM keys WHERE id = ? AND enabled = 1)
    AND EXISTS (SELECT 1 FROM files f JOIN file_keys fk ON fk.file_id = f.id WHERE f.id = ? AND f.status = 'ready' AND fk.key_id = ?)`)
    .bind(issuanceId, user.id, key.id, file.id, file.name, marker, issuedAt, ip, user.id, key.id, file.id, key.id).run();
  if (!result.meta.changes) fail(403, 'access_revoked', '文件访问权限已变更');
  return c.json({ id: issuanceId, url: `/api/downloads/${issuanceId}`, fileName: file.name }, 201);
});
downloadRoutes.on(['GET', 'HEAD'], '/downloads/:id', async c => {
  const receipt = await c.env.DB.prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ? AND key_id = ?')
    .bind(id(c.req.param('id')), c.get('user').id, c.get('key').id).first<DownloadRow>();
  if (!receipt) fail(404, 'download_not_found', '下载记录不存在');
  const file = await authorizedFile(c, receipt.file_id);
  const marked = await handlerFor(file.original_name).mark(r2Source(c.env.BUCKET, file.object_key, file.size), utf8(receipt.marker));
  const etag = `"inkparcel-${receipt.id}"`; const modified = new Date(receipt.created_at).toUTCString();
  const headers = new Headers({ 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': disposition(receipt.signed_name),
    'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': modified, 'X-Content-Type-Options': 'nosniff' });
  const rangeHeader = c.req.header('Range'); const ifRange = c.req.header('If-Range');
  const honorRange = rangeHeader && (!ifRange || ifRange === etag || ifRange === modified);
  const range = honorRange ? parseRange(rangeHeader, marked.size) : undefined;
  if (range === null) { headers.set('Content-Range', `bytes */${marked.size}`); headers.set('Content-Length', '0'); return new Response(null, { status: 416, headers }); }
  const size = range?.length ?? marked.size;
  headers.set('Content-Length', String(size));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${marked.size}`);
  if (c.req.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  await c.env.DB.prepare("UPDATE downloads SET status = 'started' WHERE id = ? AND status = 'issued'").bind(receipt.id).run();
  return new Response(await marked.stream(range), { status: range ? 206 : 200, headers });
});

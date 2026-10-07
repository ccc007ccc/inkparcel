import { Hono } from 'hono';
import { inspectApk } from '@inkparcel/marking';
import { fileObject, now, requireFile, requireFolder, requireKeys } from './db';
import { r2Source } from './source';
import type { Bindings, FileRow, UploadRow } from './types';
import { body, fail, fields, fingerprint, id, integer, keyIds, name, nullableId } from './validation';

export const PART_SIZE = 16 * 1024 * 1024;
const MAX_SIZE = 0xffffffff;
interface Part { part_number: number; etag: string; size: number }
export const uploadRoutes = new Hono<Bindings>();
async function upload(db: D1Database, fileId: string) {
  const row = await db.prepare('SELECT * FROM uploads WHERE file_id = ?').bind(fileId).first<UploadRow>();
  if (!row) fail(404, 'upload_not_found', '上传会话不存在'); return row;
}
async function parts(db: D1Database, fileId: string) { return (await db.prepare('SELECT * FROM upload_parts WHERE file_id = ? ORDER BY part_number').bind(fileId).all<Part>()).results; }
function expectedPart(file: FileRow, number: number) {
  const count = Math.ceil(file.size / PART_SIZE);
  if (number < 1 || number > count) fail(400, 'invalid_part', '分片编号无效');
  return number === count ? file.size - (count - 1) * PART_SIZE : PART_SIZE;
}
uploadRoutes.post('/', async c => {
  const input = await body(c); fields(input, ['fileName', 'size', 'folderId', 'keyIds', 'fingerprint']);
  const fileName = name(input.fileName); if (!/\.apk$/i.test(fileName)) fail(415, 'unsupported_format', '当前仅支持 APK');
  const size = integer(input.size, 1, MAX_SIZE); const folder = nullableId(input.folderId); const keys = keyIds(input.keyIds); const hash = fingerprint(input.fingerprint);
  await Promise.all([requireFolder(c.env.DB, folder), requireKeys(c.env.DB, keys)]);
  const fileId = crypto.randomUUID(); const objectKey = `artifacts/${fileId}`;
  const multipart = await c.env.BUCKET.createMultipartUpload(objectKey, { httpMetadata: { contentType: 'application/vnd.android.package-archive' }, customMetadata: { fileId } });
  try {
    const created = now();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO files (id, name, original_name, folder_id, object_key, size, fingerprint, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(fileId, fileName, fileName, folder, objectKey, size, hash, created),
      c.env.DB.prepare('INSERT INTO uploads (file_id, multipart_id, updated_at) VALUES (?, ?, ?)').bind(fileId, multipart.uploadId, created),
      ...keys.map(key => c.env.DB.prepare('INSERT INTO file_keys (file_id, key_id) VALUES (?, ?)').bind(fileId, key))
    ]);
  } catch (error) { await multipart.abort(); throw error; }
  return c.json({ fileId, partSize: PART_SIZE, partCount: Math.ceil(size / PART_SIZE) }, 201);
});
uploadRoutes.get('/:id', async c => {
  const fileId = id(c.req.param('id')); const [row, file, completed] = await Promise.all([upload(c.env.DB, fileId), requireFile(c.env.DB, fileId), parts(c.env.DB, fileId)]);
  return c.json({ fileId, partSize: PART_SIZE, partCount: Math.ceil(file.size / PART_SIZE), state: row.state, parts: completed.map(p => ({ partNumber: p.part_number, etag: p.etag, size: p.size })) });
});
uploadRoutes.put('/:id/parts/:number', async c => {
  const fileId = id(c.req.param('id')); const raw = c.req.param('number');
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) fail(400, 'invalid_part', '分片编号无效');
  const number = Number(raw); const [row, file] = await Promise.all([upload(c.env.DB, fileId), requireFile(c.env.DB, fileId)]);
  if (row.state !== 'uploading' || file.status !== 'pending') fail(409, 'upload_not_writable', '上传会话不可写入');
  const size = expectedPart(file, number);
  const headerLength = c.req.header('Content-Length');
  if (headerLength && (!/^\d+$/.test(headerLength) || Number(headerLength) !== size)) fail(400, 'part_size_mismatch', '分片大小不匹配');
  if (!c.req.raw.body) fail(400, 'empty_part', '分片不能为空');
  const token = crypto.randomUUID(); const current = now(); const expires = new Date(Date.now() + 30 * 60000).toISOString();
  const lock = await c.env.DB.prepare(`INSERT INTO upload_part_locks (file_id, part_number, token, expires_at)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM uploads WHERE file_id = ? AND state = 'uploading')
    ON CONFLICT(file_id, part_number) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
    WHERE upload_part_locks.expires_at < ? RETURNING token`).bind(fileId, number, token, expires, fileId, current).first<{token: string}>();
  if (!lock) fail(409, 'part_busy', '该分片正在上传或会话正在完成');
  try {
    // FixedLengthStream enforces the exact body length without buffering a part in the Worker.
    const stream = new FixedLengthStream(size);
    const pumping = c.req.raw.body.pipeTo(stream.writable);
    const writing = c.env.BUCKET.resumeMultipartUpload(file.object_key, row.multipart_id).uploadPart(number, stream.readable);
    const [part] = await Promise.all([writing, pumping]);
    const result = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO upload_parts (file_id, part_number, etag, size)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM upload_part_locks WHERE file_id = ? AND part_number = ? AND token = ?)
        AND EXISTS (SELECT 1 FROM uploads WHERE file_id = ? AND state = 'uploading')
        ON CONFLICT(file_id, part_number) DO UPDATE SET etag = excluded.etag, size = excluded.size`).bind(fileId, number, part.etag, size, fileId, number, token, fileId),
      c.env.DB.prepare("UPDATE uploads SET updated_at = ? WHERE file_id = ? AND state = 'uploading'").bind(now(), fileId),
      c.env.DB.prepare('DELETE FROM upload_part_locks WHERE file_id = ? AND part_number = ? AND token = ?').bind(fileId, number, token)
    ]);
    if (!result[0].meta.changes) fail(409, 'upload_changed', '上传会话已中止，请重新加载');
    return c.json({ partNumber: number, etag: part.etag, size });
  } finally { await c.env.DB.prepare('DELETE FROM upload_part_locks WHERE file_id = ? AND part_number = ? AND token = ?').bind(fileId, number, token).run(); }
});
uploadRoutes.post('/:id/complete', async c => {
  const input = await body(c); fields(input, []);
  const fileId = id(c.req.param('id')); const [row, file] = await Promise.all([upload(c.env.DB, fileId), requireFile(c.env.DB, fileId)]);
  if (file.status === 'ready') return c.json({ file: await fileObject(c.env.DB, file) });
  if (!['uploading', 'completing'].includes(row.state) || file.status !== 'pending') fail(409, 'upload_not_completable', '上传会话无法完成');
  let object = await c.env.BUCKET.head(file.object_key);
  if (!object) {
    const current = now(); const stale = new Date(Date.now() - 5 * 60000).toISOString();
    const locked = await c.env.DB.prepare(`UPDATE uploads SET state = 'completing', updated_at = ? WHERE file_id = ?
      AND (state = 'uploading' OR (state = 'completing' AND updated_at < ?))
      AND NOT EXISTS (SELECT 1 FROM upload_part_locks WHERE file_id = ? AND expires_at >= ?) RETURNING *`).bind(current, fileId, stale, fileId, current).first<UploadRow>();
    if (!locked) fail(409, 'upload_busy', '上传分片或完成请求仍在进行，请稍后重试');
    try {
      const completed = await parts(c.env.DB, fileId);
      if (completed.length !== Math.ceil(file.size / PART_SIZE) || completed.some((p, i) => p.part_number !== i + 1 || p.size !== expectedPart(file, p.part_number))) fail(409, 'missing_parts', '尚有未完成分片');
      await c.env.BUCKET.resumeMultipartUpload(file.object_key, row.multipart_id).complete(completed.map(p => ({ partNumber: p.part_number, etag: p.etag })));
      object = await c.env.BUCKET.head(file.object_key);
    } catch (error) {
      // Completion may have reached R2 even when its response was interrupted. The next attempt checks head first.
      await c.env.DB.prepare("UPDATE uploads SET state = 'uploading', updated_at = ? WHERE file_id = ? AND state = 'completing'").bind(now(), fileId).run(); throw error;
    }
  }
  try {
    if (!object || object.size !== file.size) fail(422, 'file_size_mismatch', '上传文件大小不符');
    const inspection = await inspectApk(r2Source(c.env.BUCKET, file.object_key, file.size)) as { hasMarker: boolean };
    if (inspection.hasMarker) fail(422, 'already_marked', '请上传未带 InkParcel 标记的原始 APK');
  } catch (error) {
    await c.env.DB.prepare("UPDATE uploads SET state = 'failed', updated_at = ? WHERE file_id = ? AND state IN ('uploading', 'completing')").bind(now(), fileId).run();
    if (error instanceof Error && 'status' in error) throw error;
    fail(422, 'invalid_apk', error instanceof Error ? `APK 校验失败：${error.message}` : 'APK 校验失败');
  }
  const completedAt = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE files SET status = 'ready', uploaded_at = ? WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM uploads WHERE file_id = ? AND state IN ('uploading', 'completing'))").bind(completedAt, fileId, fileId),
    c.env.DB.prepare("UPDATE uploads SET state = 'completed', updated_at = ? WHERE file_id = ? AND EXISTS (SELECT 1 FROM files WHERE id = ? AND status = 'ready')").bind(completedAt, fileId, fileId)
  ]);
  if (!results[0].meta.changes && (await requireFile(c.env.DB, fileId)).status !== 'ready') fail(409, 'upload_changed', '上传会话已中止');
  return c.json({ file: await fileObject(c.env.DB, await requireFile(c.env.DB, fileId)) });
});
uploadRoutes.delete('/:id', async c => {
  const fileId = id(c.req.param('id')); const [row, file] = await Promise.all([upload(c.env.DB, fileId), requireFile(c.env.DB, fileId)]);
  if (file.status === 'ready' || row.state === 'completed') fail(409, 'upload_completed', '上传已完成，请使用文件删除');
  const changed = await c.env.DB.prepare("UPDATE uploads SET state = 'aborting', updated_at = ? WHERE file_id = ? AND state NOT IN ('completed', 'aborted') RETURNING *").bind(now(), fileId).first();
  if (changed) {
    try { await c.env.BUCKET.resumeMultipartUpload(file.object_key, row.multipart_id).abort(); }
    catch (error) { if (!(error instanceof Error) || !/does not exist|not found|already (?:completed|aborted)|NoSuchUpload/i.test(error.message)) throw error; }
    await c.env.BUCKET.delete(file.object_key);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE uploads SET state = 'aborted', updated_at = ? WHERE file_id = ?").bind(now(), fileId),
      c.env.DB.prepare("UPDATE files SET status = 'deleted', object_deleted = 1 WHERE id = ? AND status = 'pending'").bind(fileId),
      c.env.DB.prepare('DELETE FROM upload_part_locks WHERE file_id = ?').bind(fileId)
    ]);
  }
  return c.json({ ok: true });
});

import type { Env, FileRow, UploadRow } from './types';
import { now, settings } from './db';

export async function cleanup(env: Env) {
  const config = await settings(env.DB);
  if (!config) return;
  const cutoff = new Date(Date.now() - config.ip_retention_days * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE downloads SET ip = NULL WHERE ip IS NOT NULL AND created_at <= ?').bind(cutoff),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 86400),
    env.DB.prepare('DELETE FROM upload_part_locks WHERE expires_at < ?').bind(now())
  ]);
  const stale = new Date(Date.now() - 86400000).toISOString();
  const uploads = await env.DB.prepare(`SELECT f.*, u.multipart_id, u.state FROM uploads u JOIN files f ON f.id = u.file_id
    WHERE u.state NOT IN ('completed', 'aborted') AND u.updated_at < ? ORDER BY u.updated_at LIMIT 5`).bind(stale).all<FileRow & UploadRow>();
  for (const row of uploads.results) {
    const lock = await env.DB.prepare(`UPDATE uploads SET state = 'aborting', updated_at = ? WHERE file_id = ? AND updated_at < ? AND state NOT IN ('completed', 'aborted') RETURNING file_id`).bind(now(), row.id, stale).first();
    if (!lock) continue;
    try {
      try { await env.BUCKET.resumeMultipartUpload(row.object_key, row.multipart_id).abort(); }
      catch (error) { if (!(error instanceof Error) || !/does not exist|not found|already (?:completed|aborted)|NoSuchUpload/i.test(error.message)) throw error; }
      await env.BUCKET.delete(row.object_key);
      await env.DB.batch([
        env.DB.prepare("UPDATE uploads SET state = 'aborted', updated_at = ? WHERE file_id = ? AND state = 'aborting'").bind(now(), row.id),
        env.DB.prepare("UPDATE files SET status = 'deleted', object_deleted = 1 WHERE id = ? AND status = 'pending'").bind(row.id)
      ]);
    } catch {
      // Keep the upload recoverable. The next daily pass retries transient R2 failures.
    }
  }
  const retired = await env.DB.prepare("SELECT id, object_key FROM files WHERE status = 'deleted' AND object_deleted = 0 LIMIT 5").all<{id: string; object_key: string}>();
  for (const file of retired.results) {
    await env.BUCKET.delete(file.object_key);
    await env.DB.prepare("UPDATE files SET object_deleted = 1 WHERE id = ? AND status = 'deleted'").bind(file.id).run();
  }
}

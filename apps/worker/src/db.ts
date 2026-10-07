import type { Ctx, DownloadRow, FileRow, FolderRow, KeyRow, SettingsRow, UserRow } from './types';
import { fail } from './validation';

export async function settings(db: D1Database) {
  return db.prepare('SELECT * FROM settings WHERE id = 1').first<SettingsRow>();
}
export const keyObject = (row: KeyRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  enabled: !!row.enabled,
  createdAt: row.created_at,
});
export const userObject = (row: UserRow) => ({
  id: row.id,
  userId: row.user_id,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  notes: row.notes,
  blocked: !!row.blocked,
});
export const publicFile = (row: FileRow) => ({
  id: row.id,
  name: row.name,
  size: row.size,
  uploadedAt: row.uploaded_at,
});
export const publicFolder = (row: FolderRow) => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id,
});
export async function folderObject(db: D1Database, row: FolderRow) {
  const keys = await db
    .prepare('SELECT key_id FROM folder_keys WHERE folder_id = ? ORDER BY key_id')
    .bind(row.id)
    .all<{ key_id: string }>();
  return { ...publicFolder(row), defaultKeyIds: keys.results.map((k) => k.key_id) };
}
export async function fileObject(db: D1Database, row: FileRow) {
  const keys = await db
    .prepare('SELECT key_id FROM file_keys WHERE file_id = ? ORDER BY key_id')
    .bind(row.id)
    .all<{ key_id: string }>();
  return {
    ...publicFile(row),
    originalName: row.original_name,
    folderId: row.folder_id,
    fingerprint: row.fingerprint,
    keyIds: keys.results.map((k) => k.key_id),
    status: row.status,
  };
}
export async function fileObjects(db: D1Database, rows: FileRow[]) {
  if (!rows.length) return [];
  const links = await db
    .prepare(
      `SELECT file_id, key_id FROM file_keys WHERE file_id IN (${rows.map(() => '?').join(',')}) ORDER BY key_id`,
    )
    .bind(...rows.map((row) => row.id))
    .all<{ file_id: string; key_id: string }>();
  return rows.map((row) => ({
    ...publicFile(row),
    originalName: row.original_name,
    folderId: row.folder_id,
    fingerprint: row.fingerprint,
    keyIds: links.results.filter((link) => link.file_id === row.id).map((link) => link.key_id),
    status: row.status,
  }));
}
export async function folderObjects(db: D1Database, rows: FolderRow[]) {
  const links = await db
    .prepare('SELECT folder_id, key_id FROM folder_keys ORDER BY key_id')
    .all<{ folder_id: string; key_id: string }>();
  return rows.map((row) => ({
    ...publicFolder(row),
    defaultKeyIds: links.results
      .filter((link) => link.folder_id === row.id)
      .map((link) => link.key_id),
  }));
}
export function downloadObject(row: DownloadRow & { user_name?: string; key_name?: string }) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    keyId: row.key_id,
    keyName: row.key_name,
    fileId: row.file_id,
    fileName: row.signed_name,
    createdAt: row.created_at,
    ip: row.ip,
    status: row.status,
  };
}
export async function requireKeys(db: D1Database, ids: string[]) {
  if (!ids.length) return;
  const rows = await db
    .prepare(`SELECT id FROM keys WHERE deleted = 0 AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all();
  if (rows.results.length !== ids.length) fail(400, 'unknown_key', '选择的密钥不存在');
}
export async function requireFolder(db: D1Database, id: string | null): Promise<FolderRow | null> {
  if (!id) return null;
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first<FolderRow>();
  if (!row) fail(404, 'folder_not_found', '文件夹不存在');
  return row;
}
export async function requireFile(db: D1Database, id: string): Promise<FileRow> {
  const row = await db.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<FileRow>();
  if (!row) fail(404, 'file_not_found', '文件不存在');
  return row;
}
export async function authorizedFile(c: Ctx, id: string) {
  const row = await c.env.DB.prepare(
    `SELECT f.* FROM files f JOIN file_keys fk ON fk.file_id = f.id WHERE f.id = ? AND fk.key_id = ? AND f.status = 'ready'`,
  )
    .bind(id, c.get('key').id)
    .first<FileRow>();
  if (!row) fail(404, 'file_not_found', '文件不存在或无权访问');
  return row;
}
export const now = () => new Date().toISOString();

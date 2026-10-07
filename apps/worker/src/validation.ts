import type { Ctx } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
export async function body(c: Ctx): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') || '')) fail(415, 'json_required', '请使用 JSON 请求');
  const length = Number(c.req.header('Content-Length') || 0);
  if (length > 16384) fail(413, 'body_too_large', '请求过大');
  const reader = c.req.raw.body?.getReader();
  if (!reader) fail(400, 'invalid_json', '请求不能为空');
  const pieces: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.length;
      if (total > 16384) { await reader.cancel(); fail(413, 'body_too_large', '请求过大'); } pieces.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { fail(400, 'invalid_json', 'JSON 无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_json', '请求必须为对象');
  return value as Record<string, unknown>;
}
export function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(400, 'unknown_field', `未知字段：${key}`);
}
export function text(value: unknown, name: string, max = 128, allowEmpty = false): string {
  if (typeof value !== 'string') fail(400, 'invalid_field', `${name} 必须是文本`);
  const result = value.trim().normalize('NFC');
  if ((!allowEmpty && !result) || [...result].length > max || /[\p{Cc}\p{Cf}]/u.test(result)) fail(400, 'invalid_field', `${name} 格式无效`);
  return result;
}
export function userId(value: unknown) { return text(value, '用户 ID'); }
export function name(value: unknown): string {
  const result = text(value, '名称', 255);
  if (result === '.' || result === '..' || /[/\\]/.test(result)) fail(400, 'invalid_name', '名称不能包含路径');
  return result;
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) fail(400, 'invalid_id', 'ID 无效');
  return value;
}
export function nullableId(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : id(value); }
export function boolean(value: unknown): boolean { if (typeof value !== 'boolean') fail(400, 'invalid_boolean', '需要布尔值'); return value; }
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(400, 'invalid_number', '数字超出范围'); return value;
}
export function keyIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) fail(400, 'invalid_keys', '密钥选择无效');
  const list = value.map(id); if (new Set(list).size !== list.length) fail(400, 'invalid_keys', '密钥重复'); return list;
}
export function adminPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\/[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/.test(value)) fail(400, 'invalid_admin_path', '管理路径需要 8–64 个字母、数字、下划线或连字符');
  if (['/admin', '/api', '/assets', '/favicon', '/robots', '/downloads'].includes(value.toLowerCase())) fail(400, 'reserved_admin_path', '管理路径与保留路径冲突'); return value;
}
export function fingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(400, 'invalid_fingerprint', '文件指纹无效'); return value;
}
export function pagination(c: Ctx) {
  const raw = c.req.query('page') || '1';
  if (!/^[1-9][0-9]{0,6}$/.test(raw)) fail(400, 'invalid_page', '页码无效');
  const page = Number(raw); return { page, pageSize: 50, offset: (page - 1) * 50 };
}
export function query(c: Ctx): string { return c.req.query('q') === undefined ? '' : text(c.req.query('q'), '搜索', 128, true); }
export function like(value: string) { return `%${value.replace(/[\\%_]/g, '\\$&')}%`; }
export function assertOrigin(c: Ctx) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return;
  if (c.req.header('Origin') !== new URL(c.req.url).origin) fail(403, 'origin_rejected', '请求来源无效');
  const site = c.req.header('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') fail(403, 'origin_rejected', '请求来源无效');
}

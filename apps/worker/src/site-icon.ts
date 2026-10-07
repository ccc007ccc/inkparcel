import type { Ctx } from './types';
import { fail } from './validation';

export const ICON_LIMIT = 256 * 1024;
export function iconUrl(version?: string | null): string {
  return version ? `/api/site-icon?v=${version}` : '/api/site-icon';
}
export async function readIcon(c: Ctx): Promise<Uint8Array> {
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'image/png')
    fail(415, 'icon_format', '图标请使用 PNG 图片');
  if (Number(c.req.header('Content-Length') || 0) > ICON_LIMIT)
    fail(413, 'icon_too_large', '图标不能超过 256 KiB');
  const reader = c.req.raw.body?.getReader();
  if (!reader) fail(400, 'icon_empty', '请选择图标文件');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > ICON_LIMIT) {
        await reader.cancel();
        fail(413, 'icon_too_large', '图标不能超过 256 KiB');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const view = new DataView(bytes.buffer);
  if (
    size < 45 ||
    !signature.every((byte, index) => bytes[index] === byte) ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452 ||
    view.getUint32(size - 12) !== 0 ||
    view.getUint32(size - 8) !== 0x49454e44
  )
    fail(400, 'icon_format', 'PNG 图标格式无效');
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (!width || !height || width > 1024 || height > 1024)
    fail(400, 'icon_dimensions', '图标宽高须为 1–1024 像素，建议使用正方形图片');
  return bytes;
}
export const defaultIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#506844"/><path d="M10 6h8l5 5v15H10z" fill="none" stroke="#fff" stroke-width="2"/><path d="M18 6v6h5M13 17h7M13 21h7" fill="none" stroke="#fff" stroke-width="2"/></svg>';

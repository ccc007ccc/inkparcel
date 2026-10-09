import { recipientIdentity } from './auth';
import { decode, equal, keyedValue } from './crypto';
import { downloadSources } from './download-sources';
import type { Ctx, DownloadRow, Env } from './types';
import { fail, id } from './validation';

export const DOWNLOAD_GRANT_TTL = 3600;
export function downloadGrant(env: Env, receiptId: string, source: string, expires: number) {
  return keyedValue(env, 'download-grant', JSON.stringify([receiptId, source, expires]));
}
export async function downloadIdentity(c: Ctx) {
  const receiptId = id(c.req.param('id'));
  const source = c.req.query('source') || '';
  const expires = Number(c.req.query('expires'));
  const token = c.req.query('token');
  const now = Math.floor(Date.now() / 1000);
  if (
    !downloadSources(c).some((item) => item.origin === source) ||
    !Number.isSafeInteger(expires) ||
    expires <= now ||
    expires > now + DOWNLOAD_GRANT_TTL
  )
    fail(401, 'invalid_download_token', '下载链接已失效，请重新选择下载源');
  let valid = false;
  try {
    valid = equal(
      decode(token, 32, 32),
      decode(await downloadGrant(c.env, receiptId, source, expires), 32, 32),
    );
  } catch {
    // Malformed bearer credentials never fall back to a broader cookie session.
  }
  if (!valid) fail(401, 'invalid_download_token', '下载链接已失效，请重新选择下载源');
  const receipt = await c.env.DB.prepare('SELECT * FROM downloads WHERE id = ?')
    .bind(receiptId)
    .first<DownloadRow>();
  if (!receipt) fail(404, 'download_not_found', '下载记录不存在');
  await recipientIdentity(c, receipt.user_id, receipt.key_id);
}

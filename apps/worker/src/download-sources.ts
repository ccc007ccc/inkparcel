import type { Ctx, DownloadSource } from './types';
import { fail, fields, text } from './validation';

export function validateDownloadSources(value: unknown, local = false): DownloadSource[] {
  if (!Array.isArray(value) || value.length > 8)
    fail(400, 'invalid_download_sources', '最多配置 8 个下载源');
  const sources = value.map((entry): DownloadSource => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      fail(400, 'invalid_download_sources', '下载源格式无效');
    fields(entry, ['name', 'origin']);
    const name = text(entry.name, '下载源名称', 40);
    const raw = text(entry.origin, '下载源地址', 256);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      fail(400, 'invalid_download_sources', '下载源需为 HTTPS 域名地址');
    }
    const loopback = local && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.hostname.includes('*') ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !/^https?:\/\/[^/?#\\]+\/?$/i.test(raw)
    )
      fail(
        400,
        'invalid_download_sources',
        '下载源需为 HTTPS 域名地址，不能包含路径、凭据或查询参数',
      );
    return { name, origin: url.origin };
  });
  if (new Set(sources.map((source) => source.origin)).size !== sources.length)
    fail(400, 'invalid_download_sources', '下载源域名不能重复');
  return sources;
}

export function downloadSources(c: Ctx): DownloadSource[] {
  return JSON.parse(c.get('settings')?.download_sources || '[]') as DownloadSource[];
}

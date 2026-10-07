import { t, i18n, getLocale, errorMessageKey } from './i18n';
export interface Key {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  createdAt: string;
}
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  defaultKeyIds?: string[];
}
export interface PublicFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
}
export interface AdminFile extends PublicFile {
  originalName: string;
  folderId: string | null;
  fingerprint: string;
  keyIds: string[];
  status: string;
}
export interface User {
  id: string;
  userId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  notes: string;
  blocked: boolean;
}
export interface Download {
  id: string;
  userId: string;
  userName: string;
  keyId: string;
  keyName: string;
  fileId: string;
  fileName: string;
  createdAt: string;
  ip: string | null;
  status: string;
}
export interface Session {
  user: {
    id: string;
    userId: string;
  };
  key: {
    id: string;
    name: string;
  };
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Settings {
  iconUrl: string;
  hasCustomIcon: boolean;
  stealthMode: boolean;
  siteName: string;
  adminPath: string;
  ipRetentionDays: number;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export interface AuthExpired {
  path: string;
  code: string;
  message: string;
}
export const authExpiredEvent = 'inkparcel:auth-expired';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && typeof options.body === 'string')
    headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? t('error.request_failed'),
    );
    if (
      typeof window !== 'undefined' &&
      ['admin_auth_required', 'auth_required', 'access_revoked'].includes(error.code)
    ) {
      window.dispatchEvent(
        new CustomEvent<AuthExpired>(authExpiredEvent, {
          detail: { path, code: error.code, message: errorMessageKey(error.code) },
        }),
      );
    }
    throw error;
  }
  return body as T;
}
export const post = <T>(path: string, data: unknown = {}, signal?: AbortSignal) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data), signal });
export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const remove = (path: string) =>
  api<{
    ok: true;
  }>(path, { method: 'DELETE' });
export function query(values: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(values))
    if (value !== null && value !== undefined && value !== '') search.set(name, String(value));
  return search.size ? `?${search}` : '';
}
export function message(error: unknown) {
  if (error instanceof ApiError) return errorMessageKey(error.code);
  if (error instanceof Error && i18n.exists(error.message)) return error.message;
  if (error instanceof Error && 'code' in error) return 'error.marking';
  return '发生了意外错误，请重试。';
}
export function bytes(size: number) {
  if (!size) return '0 B';
  const unit = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 4);
  return `${(size / 1024 ** unit).toLocaleString(getLocale(), { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
export function date(value: string | null | undefined, time = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(time ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(parsed);
}
export function base64url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function unbase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('密码参数格式错误。');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
    char.charCodeAt(0),
  );
}
export function passwordSalt() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}
export async function passwordKey(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const result = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: unbase64url(salt) },
    key,
    256,
  );
  return base64url(new Uint8Array(result));
}
export function folderTrail(folders: Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  const result: Folder[] = [];
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    if (!folder) break;
    result.unshift(folder);
    id = folder.parentId;
  }
  return result;
}
export function descendants(folders: Folder[], id: string): Set<string> {
  const result = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders)
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
  }
  return result;
}
export async function copy(value: string) {
  await navigator.clipboard.writeText(value);
}
export function downloadUrl(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
}

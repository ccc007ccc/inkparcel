import { api, post } from './lib';
export interface SavedUpload {
  fileId: string;
  name: string;
  size: number;
  lastModified: number;
  fingerprint: string;
  partSize: number;
  partCount: number;
}
export interface UploadState {
  fileId: string;
  partSize: number;
  partCount: number;
  state?: string;
  parts: { partNumber: number; etag: string; size: number }[];
}
const storageKey = 'inkparcel.pending-uploads.v1';
export function savedUploads(): SavedUpload[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value)
      ? value.filter(
          (item): item is SavedUpload =>
            item &&
            typeof item.fileId === 'string' &&
            typeof item.name === 'string' &&
            Number.isSafeInteger(item.size) &&
            Number.isSafeInteger(item.partSize) &&
            item.partSize > 0 &&
            Number.isSafeInteger(item.partCount) &&
            typeof item.fingerprint === 'string',
        )
      : [];
  } catch {
    return [];
  }
}
export function saveUpload(value: SavedUpload) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify([...savedUploads().filter((item) => item.fileId !== value.fileId), value]),
    );
  } catch {
    /* The server session remains recoverable from the file library. */
  }
}
export function forgetUpload(id: string) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(savedUploads().filter((item) => item.fileId !== id)),
    );
  } catch {
    /* Restricted browser storage does not invalidate server upload state. */
  }
}
export function uploadParts(size: number, partSize: number, completed: UploadState['parts']) {
  if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(partSize) || partSize <= 0)
    throw new Error('上传分片参数无效。');
  const count = Math.ceil(size / partSize);
  const done = new Set(
    completed
      .filter(
        (part) =>
          part.partNumber >= 1 &&
          part.partNumber <= count &&
          part.size === Math.min(partSize, size - (part.partNumber - 1) * partSize),
      )
      .map((part) => part.partNumber),
  );
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    offset: index * partSize,
    size: Math.min(partSize, size - index * partSize),
    done: done.has(index + 1),
  }));
}
export async function sendUpload(
  base: string,
  saved: SavedUpload,
  file: File,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
) {
  const state = await api<UploadState>(`${base}/api/uploads/${saved.fileId}`, { signal });
  if (state.state === 'failed') throw new Error('该上传文件未通过校验，请取消上传后重新选择文件。');
  if (
    state.partSize !== saved.partSize ||
    state.partCount !== Math.ceil(file.size / saved.partSize)
  )
    throw new Error('上传会话与本地文件不匹配。');
  const parts = uploadParts(file.size, state.partSize, state.parts);
  let sent = parts.filter((part) => part.done).reduce((sum, part) => sum + part.size, 0);
  onProgress(sent);
  for (const part of parts) {
    if (part.done) continue;
    signal.throwIfAborted();
    await api(`${base}/api/uploads/${saved.fileId}/parts/${part.number}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file.slice(part.offset, part.offset + part.size),
      signal,
    });
    sent += part.size;
    onProgress(sent);
  }
  signal.throwIfAborted();
  return post(`${base}/api/uploads/${saved.fileId}/complete`, {}, signal);
}

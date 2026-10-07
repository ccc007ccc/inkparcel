import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalApk } from './apk';
import type { ByteSource } from './types';

/** SHA-256 of the canonical APK, including all signing-identity bytes. Browser only for large files. */
export async function fingerprintApk(
  source: ByteSource,
  onProgress?: (bytes: number, total: number) => void,
): Promise<string> {
  const canonical = await canonicalApk(source);
  const digest = sha256.create();
  const reader = (await canonical.stream()).getReader();
  let processed = 0;
  try {
    onProgress?.(0, canonical.size);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      digest.update(value);
      processed += value.byteLength;
      onProgress?.(processed, canonical.size);
    }
    return Array.from(digest.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    digest.destroy();
    reader.releaseLock();
  }
}

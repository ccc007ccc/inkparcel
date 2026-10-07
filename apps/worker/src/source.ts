import type { ByteSource } from '@inkparcel/marking';
import { fail } from './validation';

export function r2Source(bucket: R2Bucket, objectKey: string, size: number): ByteSource {
  // Adjacent parser reads share a bounded window. A maximum-size signing block must
  // not turn 256 small reads into 256 R2 subrequests on the Workers Free plan.
  const WINDOW_SIZE = 1024 * 1024;
  let cachedOffset = -1; let cached = new Uint8Array();
  const check = (offset: number, length: number) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) throw new RangeError('Invalid source range');
  };
  return {
    size,
    async read(offset, length) {
      check(offset, length); if (length > 65536) throw new RangeError('Random reads are limited to 64 KiB');
      if (!length) return new Uint8Array();
      if (offset >= cachedOffset && offset + length <= cachedOffset + cached.length) return cached.slice(offset - cachedOffset, offset - cachedOffset + length);
      const windowLength = Math.min(WINDOW_SIZE, size - offset);
      const object = await bucket.get(objectKey, { range: { offset, length: windowLength } });
      if (!object) fail(503, 'object_unavailable', '文件对象暂不可用');
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.length !== windowLength) fail(503, 'object_incomplete', '文件对象不完整');
      cachedOffset = offset; cached = bytes;
      return bytes.slice(0, length);
    },
    async stream(offset, length) {
      check(offset, length);
      if (!length) return new ReadableStream({ start(controller) { controller.close(); } });
      const object = await bucket.get(objectKey, { range: { offset, length } });
      if (!object) fail(503, 'object_unavailable', '文件对象暂不可用'); return object.body;
    }
  };
}

import { MarkingError, type ByteRange, type ByteSource } from './types';

export const MAX_READ_SIZE = 64 * 1024;

export function checkRange(size: number, { offset, length }: ByteRange): void {
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > size ||
    length > size - offset
  ) {
    throw new MarkingError('INVALID_RANGE', 'The requested byte range is outside the file.');
  }
}

/** All parser reads go through this bounded and exact-length adapter. */
export async function readBytes(
  source: ByteSource,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  checkRange(source.size, { offset, length });
  const result = new Uint8Array(length);
  for (let done = 0; done < length;) {
    const count = Math.min(MAX_READ_SIZE, length - done);
    const bytes = await source.read(offset + done, count);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== count) {
      throw new MarkingError('TRUNCATED_SOURCE', 'The source did not return the requested bytes.');
    }
    result.set(bytes, done);
    done += count;
  }
  return result;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(offset, length) {
      checkRange(blob.size, { offset, length });
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    },
    async stream(offset, length) {
      checkRange(blob.size, { offset, length });
      return blob.slice(offset, offset + length).stream();
    },
  };
}

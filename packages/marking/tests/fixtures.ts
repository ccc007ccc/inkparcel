import type { ByteSource } from '../src';

export interface TestEntry { id: number; value: Uint8Array }
const encoder = new TextEncoder();

export function concatenate(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

/** Structural ZIP fixture, deliberately not presented as an Android-signed APK. */
export function makeApk(options: {
  entries?: TestEntry[]; comment?: Uint8Array; blockOffset?: number; padding?: number;
} = {}): { bytes: Uint8Array; blockOffset: number; blockSize: number; cdOffset: number; eocdOffset: number } {
  const entries = options.entries ?? [{ id: 0x7109871a, value: encoder.encode('synthetic signing identity') }];
  const pairBytes = entries.map(({ id, value }) => {
    const pair = new Uint8Array(12 + value.length);
    const data = new DataView(pair.buffer);
    data.setBigUint64(0, BigInt(4 + value.length), true);
    data.setUint32(8, id, true);
    pair.set(value, 12);
    return pair;
  });
  const blockSize = 32 + pairBytes.reduce((size, pair) => size + pair.length, 0);
  const block = new Uint8Array(blockSize);
  const bv = new DataView(block.buffer);
  bv.setBigUint64(0, BigInt(blockSize - 8), true);
  let pairOffset = 8;
  for (const pair of pairBytes) { block.set(pair, pairOffset); pairOffset += pair.length; }
  bv.setBigUint64(block.length - 24, BigInt(blockSize - 8), true);
  block.set(encoder.encode('APK Sig Block 42'), block.length - 16);
  const blockOffset = options.blockOffset ?? 96;
  const prefix = new Uint8Array(options.blockOffset ? 0 : blockOffset);
  prefix.set(encoder.encode('PK\u0003\u0004generic test content').subarray(0, prefix.length));
  const cd = new Uint8Array(46);
  new DataView(cd.buffer).setUint32(0, 0x02014b50, true);
  const comment = options.comment ?? new Uint8Array();
  const eocd = new Uint8Array(22 + comment.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, blockOffset + block.length, true);
  ev.setUint16(20, comment.length, true);
  eocd.set(comment, 22);
  return {
    bytes: concatenate(prefix, block, cd, eocd), blockOffset, blockSize,
    cdOffset: blockOffset + block.length, eocdOffset: blockOffset + block.length + cd.length,
  };
}

export function memorySource(bytes: Uint8Array, maxChunk = 113): ByteSource & { reads: number[] } {
  const reads: number[] = [];
  return {
    size: bytes.length, reads,
    async read(offset, length) { reads.push(length); return bytes.slice(offset, offset + length); },
    async stream(offset, length) {
      let position = offset;
      return new ReadableStream({
        pull(controller) {
          if (position === offset + length) { controller.close(); return; }
          const next = Math.min(position + maxChunk, offset + length);
          controller.enqueue(bytes.slice(position, next));
          position = next;
        },
      });
    },
  };
}

export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return concatenate(...chunks);
}

export function entriesIn(bytes: Uint8Array): TestEntry[] {
  const ev = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22, 22);
  const cdOffset = ev.getUint32(16, true);
  const blockSize = Number(new DataView(bytes.buffer, bytes.byteOffset + cdOffset - 24, 8).getBigUint64(0, true)) + 8;
  const data = new DataView(bytes.buffer, bytes.byteOffset);
  const entries: TestEntry[] = [];
  for (let offset = cdOffset - blockSize + 8; offset < cdOffset - 24;) {
    const length = Number(data.getBigUint64(offset, true));
    entries.push({ id: data.getUint32(offset + 8, true), value: bytes.slice(offset + 12, offset + 8 + length) });
    offset += 8 + length;
  }
  return entries;
}

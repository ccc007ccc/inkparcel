import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  apkHandler, blobSource, fingerprintApk, handlerFor, inspectApk, APK_MARKER_ID,
  APK_V2_ID, APK_V3_ID, APK_V31_ID, APK_VERITY_PADDING_ID, MAX_MARKER_SIZE,
  MAX_READ_SIZE, type ByteSource,
} from '../src';
import { collect, concatenate, entriesIn, makeApk, memorySource } from './fixtures';

const text = (s: string) => new TextEncoder().encode(s);
const v2 = { id: APK_V2_ID, value: text('original signing identity') };
const marker = text('{"version":1,"opaque":"test issuance"}');

describe('APK marking and content identity', () => {
  it('round-trips an opaque marker while preserving signatures, unknown pairs and their order', async () => {
    const entries = [v2, { id: 25, value: text('first') }, { id: APK_V3_ID, value: text('v3 identity') },
      { id: 25, value: text('second') }, { id: APK_V31_ID, value: text('v3.1 identity') }];
    const fixture = makeApk({ entries });
    const source = memorySource(fixture.bytes);
    expect(await apkHandler.extract(source)).toBeNull();
    const output = await apkHandler.mark(source, marker);
    const bytes = await collect(await output.stream());
    expect(bytes.length).toBe(output.size);
    expect(await apkHandler.extract(memorySource(bytes))).toEqual(marker);
    expect(entriesIn(bytes).filter(entry => entry.id !== APK_MARKER_ID && entry.id !== APK_VERITY_PADDING_ID)).toEqual(entries);
    expect((await inspectApk(memorySource(bytes))).signingBlockOffset).toBe(fixture.blockOffset);
    expect((await inspectApk(memorySource(bytes))).signingBlockSize % 4096).toBe(0);
    expect(await fingerprintApk(source)).toBe(await fingerprintApk(memorySource(bytes)));
    await expect(apkHandler.mark(memorySource(bytes), marker)).rejects.toMatchObject({ code: 'ALREADY_MARKED' });
  });

  it('keeps fingerprints independent of recipient marker and padding, while binding payload and signing identity', async () => {
    const a = makeApk({ entries: [v2, { id: APK_VERITY_PADDING_ID, value: new Uint8Array(8000) }] });
    const b = makeApk({ entries: [v2, { id: APK_VERITY_PADDING_ID, value: new Uint8Array(123) }] });
    const fingerprint = await fingerprintApk(memorySource(a.bytes));
    expect(await fingerprintApk(memorySource(b.bytes))).toBe(fingerprint);
    for (const value of [text('recipient one'), text('recipient two, different length')]) {
      const marked = await apkHandler.mark(memorySource(a.bytes), value);
      expect(await fingerprintApk(memorySource(await collect(await marked.stream())))).toBe(fingerprint);
    }
    const payloadChanged = a.bytes.slice();
    payloadChanged[12] ^= 1;
    expect(await fingerprintApk(memorySource(payloadChanged))).not.toBe(fingerprint);
    const otherSigner = makeApk({ entries: [{ ...v2, value: text('different signing identity') }] });
    expect(await fingerprintApk(memorySource(otherSigner.bytes))).not.toBe(fingerprint);
    const unknownChanged = makeApk({ entries: [v2, { id: 50, value: text('metadata') }] });
    expect(await fingerprintApk(memorySource(unknownChanged.bytes))).not.toBe(fingerprint);
  });

  it('equals ordinary SHA-256 when there is nothing to normalize and reports incremental progress', async () => {
    const fixture = makeApk();
    const progress: [number, number][] = [];
    const result = await fingerprintApk(memorySource(fixture.bytes, 7), (done, total) => progress.push([done, total]));
    expect(result).toBe(createHash('sha256').update(fixture.bytes).digest('hex'));
    expect(progress[0]).toEqual([0, fixture.bytes.length]);
    expect(progress.at(-1)).toEqual([fixture.bytes.length, fixture.bytes.length]);
    expect(progress.length).toBeGreaterThan(10);
  });

  it('reuses existing aligned padding and does not mutate the caller marker or persistent plan', async () => {
    const base = makeApk({ entries: [v2] });
    const paddingLength = 8192 - base.blockSize - 12;
    const fixture = makeApk({ entries: [v2, { id: APK_VERITY_PADDING_ID, value: new Uint8Array(paddingLength) }] });
    const suppliedMarker = marker.slice();
    const output = await apkHandler.mark(memorySource(fixture.bytes), suppliedMarker);
    suppliedMarker.fill(0);
    expect(output.size).toBe(fixture.bytes.length);
    const first = await collect(await output.stream());
    expect(await apkHandler.extract(memorySource(first))).toEqual(marker);
    first.fill(255);
    expect(await apkHandler.extract(memorySource(await collect(await output.stream())))).toEqual(marker);
  });

  it('preserves the longest ZIP comment and bounds every parser read', async () => {
    const comment = new Uint8Array(0xffff).fill(42);
    const fixture = makeApk({ entries: [v2, { id: 91, value: new Uint8Array(90_000) }], comment });
    const source = memorySource(fixture.bytes);
    const output = await apkHandler.mark(source, marker);
    const bytes = await collect(await output.stream());
    expect(bytes.slice(-comment.length)).toEqual(comment);
    expect(await fingerprintApk(memorySource(bytes))).toBe(await fingerprintApk(source));
    expect(Math.max(...source.reads)).toBeLessThanOrEqual(MAX_READ_SIZE);
  });

  it('offers extension registration with structural detection and supports browser Blob sources', async () => {
    const bytes = makeApk().bytes;
    const source = blobSource(new Blob([bytes.slice().buffer]));
    expect(handlerFor('Release.APK')).toBe(apkHandler);
    expect(await inspectApk(source)).toMatchObject({ hasMarker: false, signingSchemeIds: [APK_V2_ID] });
    expect(await collect(await source.stream(2, 10))).toEqual(bytes.slice(2, 12));
    expect(() => handlerFor('readme.txt')).toThrow(/APK/);
    await expect(inspectApk(blobSource(new Blob(['not an apk'])))).rejects.toThrow();
  });
});

describe('stable ranged streaming', () => {
  it('maps byte ranges across every transformed boundary without emitting a source file buffer', async () => {
    const fixture = makeApk();
    const source = memorySource(fixture.bytes, 13);
    const output = await apkHandler.mark(source, marker);
    const full = await collect(await output.stream());
    const info = await inspectApk(memorySource(full));
    const points = [0, 3, fixture.blockOffset - 2, fixture.blockOffset, fixture.blockOffset + 6,
      fixture.blockOffset + 19, info.centralDirectoryOffset - 9, info.centralDirectoryOffset + 1,
      info.eocdOffset - 4, info.eocdOffset + 15, output.size - 1, output.size];
    for (const offset of points) {
      for (const length of [0, 1, 7, 61, output.size - offset].filter(n => n <= output.size - offset)) {
        expect(await collect(await output.stream({ offset, length }))).toEqual(full.slice(offset, offset + length));
      }
    }
    const resumed = concatenate(
      await collect(await output.stream({ offset: 0, length: 123 })),
      await collect(await output.stream({ offset: 123, length: output.size - 123 })),
    );
    expect(resumed).toEqual(full);
    for (const range of [{ offset: -1, length: 2 }, { offset: 0.5, length: 1 },
      { offset: output.size, length: 1 }, { offset: 0, length: Number.MAX_SAFE_INTEGER }]) {
      await expect(output.stream(range)).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    }
  });

  it('parses and ranges offsets above 2 GiB without signed-int truncation or large allocations', async () => {
    const fixture = makeApk({ blockOffset: 0x80001000 });
    const prefixLength = fixture.blockOffset;
    const requests: number[] = [];
    const get = (offset: number, length: number) => {
      requests.push(length);
      if (length > 100_000) throw new Error('Unbounded access');
      const output = new Uint8Array(length);
      const from = Math.max(offset, prefixLength);
      if (from < offset + length) output.set(fixture.bytes.subarray(from - prefixLength, offset + length - prefixLength), from - offset);
      return output;
    };
    const source: ByteSource = {
      size: prefixLength + fixture.bytes.length,
      async read(offset, length) { return get(offset, length); },
      async stream(offset, length) { return new ReadableStream({ start(c) { c.enqueue(get(offset, length)); c.close(); } }); },
    };
    expect((await inspectApk(source)).centralDirectoryOffset).toBe(fixture.cdOffset);
    const output = await apkHandler.mark(source, marker);
    const range = await collect(await output.stream({ offset: prefixLength - 4, length: 16 }));
    expect(range.slice(0, 4)).toEqual(new Uint8Array(4));
    expect(new DataView(range.buffer).getBigUint64(4, true)).toBe(4088n);
    expect(Math.max(...requests)).toBeLessThanOrEqual(MAX_READ_SIZE);
  });

  it('propagates truncated and oversized source streams instead of silently issuing a corrupt APK', async () => {
    for (const delta of [-1, 1]) {
      const source = memorySource(makeApk().bytes);
      source.stream = async (_offset, length) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(length + delta)); c.close(); } });
      const output = await apkHandler.mark(source, marker);
      await expect(collect(await output.stream())).rejects.toMatchObject({ code: delta < 0 ? 'TRUNCATED_SOURCE' : 'INVALID_SOURCE_STREAM' });
    }
  });

  it('cancels the active source stream when the client stops downloading', async () => {
    const source = memorySource(makeApk().bytes);
    let cancelled = false;
    source.stream = async () => new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; },
    });
    const output = await apkHandler.mark(source, marker);
    const reader = (await output.stream()).getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
  });
});

describe('malformed and unsupported binary input', () => {
  it.each([
    ['mismatched signing sizes', 'SIGNING_SIZE_MISMATCH', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setBigUint64(f.blockOffset, 50n, true)],
    ['overflowing pair length', 'INVALID_PAIR', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setBigUint64(f.blockOffset + 8, 0xffffffffffffffffn, true)],
    ['short pair length', 'INVALID_PAIR', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setBigUint64(f.blockOffset + 8, 3n, true)],
    ['huge signing block', 'SIGNING_BLOCK_LIMIT', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setBigUint64(f.cdOffset - 24, 0xffffffffffffffffn, true)],
    ['bad directory size', 'INVALID_DIRECTORY', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setUint32(f.eocdOffset + 12, 40, true)],
    ['bad directory header', 'INVALID_DIRECTORY', (b: Uint8Array, f: ReturnType<typeof makeApk>) => { b[f.cdOffset] = 0; }],
    ['missing signing magic', 'SIGNING_BLOCK_MISSING', (b: Uint8Array, f: ReturnType<typeof makeApk>) => { b[f.cdOffset - 1] = 0; }],
    ['split archive', 'MULTIDISK_UNSUPPORTED', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setUint16(f.eocdOffset + 4, 1, true)],
    ['ZIP64 sentinel', 'ZIP64_UNSUPPORTED', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setUint32(f.eocdOffset + 16, 0xffffffff, true)],
    ['ZIP64 locator', 'ZIP64_UNSUPPORTED', (b: Uint8Array, f: ReturnType<typeof makeApk>) => new DataView(b.buffer).setUint32(f.eocdOffset - 20, 0x07064b50, true)],
  ] as const)('rejects %s', async (_name, code, mutate) => {
    const fixture = makeApk();
    mutate(fixture.bytes, fixture);
    await expect(inspectApk(memorySource(fixture.bytes))).rejects.toMatchObject({ code });
  });

  it('rejects missing/truncated EOCD and sources that return fewer bytes than requested', async () => {
    const bytes = makeApk().bytes;
    for (const damaged of [bytes.slice(0, -1), concatenate(bytes, new Uint8Array([0])), bytes.slice(0, 10)]) {
      await expect(inspectApk(memorySource(damaged))).rejects.toThrow();
    }
    const source = memorySource(bytes);
    source.read = async (offset, length) => bytes.slice(offset, offset + length - 1);
    await expect(inspectApk(source)).rejects.toMatchObject({ code: 'TRUNCATED_SOURCE' });
  });

  it('rejects ambiguous EOCD records', async () => {
    const fake = makeApk().bytes.slice(-22);
    const fixture = makeApk({ comment: fake });
    await expect(inspectApk(memorySource(fixture.bytes))).rejects.toMatchObject({ code: 'AMBIGUOUS_EOCD' });
  });

  it('rejects duplicate marker/signature/padding entries but retains duplicate unknown entries', async () => {
    for (const id of [APK_MARKER_ID, APK_VERITY_PADDING_ID, APK_V2_ID, APK_V3_ID, APK_V31_ID]) {
      const entries = [v2, { id, value: text('one') }, { id, value: text('two') }];
      await expect(inspectApk(memorySource(makeApk({ entries }).bytes))).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
    }
  });

  it('requires v2 and applies marker limits on both writing and reading', async () => {
    await expect(inspectApk(memorySource(makeApk({ entries: [{ id: APK_V3_ID, value: text('v3 only') }] }).bytes)))
      .rejects.toMatchObject({ code: 'V2_REQUIRED' });
    for (const value of [new Uint8Array(), new Uint8Array(MAX_MARKER_SIZE + 1)]) {
      await expect(apkHandler.mark(memorySource(makeApk().bytes), value)).rejects.toMatchObject({ code: 'MARKER_LIMIT' });
      const invalid = makeApk({ entries: [v2, { id: APK_MARKER_ID, value }] });
      await expect(apkHandler.extract(memorySource(invalid.bytes))).rejects.toMatchObject({ code: 'MARKER_LIMIT' });
    }
  });

  it('rejects a marking operation whose added entries would exceed the parser entry budget', async () => {
    const entries = [v2, ...Array.from({ length: 4095 }, (_, id) => ({ id: id + 1, value: new Uint8Array() }))];
    const source = memorySource(makeApk({ entries }).bytes);
    expect((await inspectApk(source)).hasMarker).toBe(false);
    await expect(apkHandler.mark(source, marker)).rejects.toMatchObject({ code: 'PAIR_LIMIT' });
  });
});

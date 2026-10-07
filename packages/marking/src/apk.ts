import { readBytes } from './source';
import { segmentedFile, type Segment } from './segments';
import { MarkingError, type ByteSource, type MarkedFile, type MarkerHandler } from './types';

export const APK_MARKER_ID = 0x49504b31;
export const APK_VERITY_PADDING_ID = 0x42726577;
export const APK_V2_ID = 0x7109871a;
export const APK_V3_ID = 0xf05368c0;
export const APK_V31_ID = 0x1b93ad61;
export const MAX_SIGNING_BLOCK_SIZE = 16 * 1024 * 1024;
export const MAX_MARKER_SIZE = 16 * 1024;
export const MAX_APK_SIZE = 0xffffffff;
const MAX_PAIRS = 4096;
const MAGIC = new TextEncoder().encode('APK Sig Block 42');
const SCHEME_IDS = new Set([APK_V2_ID, APK_V3_ID, APK_V31_ID]);

export interface ApkInspection {
  size: number;
  signingBlockOffset: number;
  signingBlockSize: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  eocdOffset: number;
  hasMarker: boolean;
  signingSchemeIds: number[];
}

interface Pair { id: number; bytes: Uint8Array }
interface ParsedApk extends ApkInspection { pairs: Pair[]; eocd: Uint8Array }

function fail(code: string, message: string): never { throw new MarkingError(code, message); }
function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

async function parseApk(source: ByteSource): Promise<ParsedApk> {
  if (!Number.isSafeInteger(source.size) || source.size < 22 || source.size > MAX_APK_SIZE) {
    fail('UNSUPPORTED_SIZE', 'APK size must be between 22 bytes and 4 GiB minus one byte.');
  }
  // The extra 20 bytes cover a possible ZIP64 locator before the longest EOCD.
  const tailOffset = Math.max(0, source.size - (22 + 0xffff + 20));
  const tail = await readBytes(source, tailOffset, source.size - tailOffset);
  const tailView = view(tail);
  let found = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50
      && i + 22 + tailView.getUint16(i + 20, true) === tail.length) {
      if (found !== -1) fail('AMBIGUOUS_EOCD', 'Multiple end-of-directory records describe the same file ending.');
      found = i;
    }
  }
  if (found === -1) fail('INVALID_EOCD', 'APK end-of-directory record is missing or has trailing bytes.');
  const eocdOffset = tailOffset + found;
  const eocd = tail.slice(found);
  const end = view(eocd);
  if (found >= 20 && tailView.getUint32(found - 20, true) === 0x07064b50) {
    fail('ZIP64_UNSUPPORTED', 'ZIP64 APKs are not supported.');
  }
  const entries = end.getUint16(10, true);
  const centralDirectorySize = end.getUint32(12, true);
  const centralDirectoryOffset = end.getUint32(16, true);
  if (entries === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    fail('ZIP64_UNSUPPORTED', 'ZIP64 APKs are not supported.');
  }
  if (end.getUint16(4, true) !== 0 || end.getUint16(6, true) !== 0 || end.getUint16(8, true) !== entries) {
    fail('MULTIDISK_UNSUPPORTED', 'Split ZIP archives are not supported.');
  }
  if (entries === 0 || centralDirectorySize < 46 || centralDirectoryOffset < 32
    || centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    fail('INVALID_DIRECTORY', 'APK central directory offsets or entry counts are invalid.');
  }
  const cdHead = await readBytes(source, centralDirectoryOffset, 4);
  if (view(cdHead).getUint32(0, true) !== 0x02014b50) fail('INVALID_DIRECTORY', 'APK central directory signature is missing.');
  const footer = await readBytes(source, centralDirectoryOffset - 24, 24);
  if (!sameBytes(footer.subarray(8), MAGIC)) fail('SIGNING_BLOCK_MISSING', 'A v2 APK signing block is required; v1-only APKs are unsupported.');
  const sizeValue = view(footer).getBigUint64(0, true);
  if (sizeValue < 24n || sizeValue + 8n > BigInt(MAX_SIGNING_BLOCK_SIZE)) {
    fail('SIGNING_BLOCK_LIMIT', 'APK signing block is malformed or exceeds the 16 MiB limit.');
  }
  const signingBlockSize = Number(sizeValue + 8n);
  const signingBlockOffset = centralDirectoryOffset - signingBlockSize;
  if (signingBlockOffset < 0) fail('INVALID_SIGNING_OFFSET', 'APK signing block starts before the file.');
  const block = await readBytes(source, signingBlockOffset, signingBlockSize);
  const blockView = view(block);
  if (blockView.getBigUint64(0, true) !== sizeValue) fail('SIGNING_SIZE_MISMATCH', 'APK signing block size fields disagree.');
  const pairs: Pair[] = [];
  const singletonIds = new Set<number>();
  for (let position = 8; position < block.length - 24;) {
    if (pairs.length >= MAX_PAIRS) fail('PAIR_LIMIT', 'APK signing block contains too many entries.');
    if (block.length - 24 - position < 12) fail('INVALID_PAIR', 'APK signing block entry header is truncated.');
    const length = blockView.getBigUint64(position, true);
    if (length < 4n || length > BigInt(block.length - 24 - position - 8)) {
      fail('INVALID_PAIR', 'APK signing block entry length is out of bounds.');
    }
    const id = blockView.getUint32(position + 8, true);
    if (id === APK_MARKER_ID || id === APK_VERITY_PADDING_ID || SCHEME_IDS.has(id)) {
      if (singletonIds.has(id)) fail('DUPLICATE_ENTRY', 'APK contains duplicate marker, padding or signature entries.');
      singletonIds.add(id);
    }
    if (id === APK_MARKER_ID && (length - 4n < 1n || length - 4n > BigInt(MAX_MARKER_SIZE))) {
      fail('MARKER_LIMIT', 'InkParcel marker is empty or exceeds the 16 KiB limit.');
    }
    const next = position + 8 + Number(length);
    pairs.push({ id, bytes: block.subarray(position, next) });
    position = next;
  }
  if (!singletonIds.has(APK_V2_ID)) fail('V2_REQUIRED', 'This release requires a v2 signature, optionally alongside v3 or v3.1.');
  return {
    size: source.size, signingBlockOffset, signingBlockSize, centralDirectoryOffset,
    centralDirectorySize, eocdOffset, hasMarker: singletonIds.has(APK_MARKER_ID),
    signingSchemeIds: pairs.filter(pair => SCHEME_IDS.has(pair.id)).map(pair => pair.id), pairs, eocd,
  };
}

export async function inspectApk(source: ByteSource): Promise<ApkInspection> {
  const { pairs: _pairs, eocd: _eocd, ...inspection } = await parseApk(source);
  return inspection;
}

function encodePair(id: number, value: Uint8Array): Uint8Array {
  const pair = new Uint8Array(12 + value.length);
  const data = view(pair);
  data.setBigUint64(0, BigInt(value.length + 4), true);
  data.setUint32(8, id, true);
  pair.set(value, 12);
  return pair;
}

function plan(source: ByteSource, parsed: ParsedApk, marker?: Uint8Array): MarkedFile {
  const entries = parsed.pairs.filter(pair => pair.id !== APK_MARKER_ID && pair.id !== APK_VERITY_PADDING_ID)
    .map(pair => pair.bytes);
  if (marker) entries.push(encodePair(APK_MARKER_ID, marker));
  let blockSize = 32 + entries.reduce((total, entry) => total + entry.length, 0);
  if (marker) {
    // Existing signing-block space is reused when possible. New space is page aligned
    // for APK verity; the signing block's original start is never moved.
    let target = Math.ceil(blockSize / 4096) * 4096;
    if (parsed.signingBlockSize % 4096 === 0) target = Math.max(target, parsed.signingBlockSize);
    if (target !== blockSize && target - blockSize < 12) target += 4096;
    if (target > MAX_SIGNING_BLOCK_SIZE) fail('SIGNING_BLOCK_LIMIT', 'Marked APK signing block would exceed 16 MiB.');
    if (target > blockSize) {
      const padding = new Uint8Array(target - blockSize);
      view(padding).setBigUint64(0, BigInt(padding.length - 8), true);
      view(padding).setUint32(8, APK_VERITY_PADDING_ID, true);
      entries.push(padding);
      blockSize = target;
    }
  }
  if (entries.length > MAX_PAIRS) fail('PAIR_LIMIT', 'Marked APK would exceed the signing-block entry limit.');
  const newDirectoryOffset = parsed.signingBlockOffset + blockSize;
  const newSize = source.size + blockSize - parsed.signingBlockSize;
  if (newDirectoryOffset >= 0xffffffff || newSize > MAX_APK_SIZE) fail('UNSUPPORTED_SIZE', 'Marked APK would exceed supported ZIP32 offsets or size.');
  const header = new Uint8Array(8);
  view(header).setBigUint64(0, BigInt(blockSize - 8), true);
  const footer = new Uint8Array(24);
  footer.set(header);
  footer.set(MAGIC, 8);
  const eocd = parsed.eocd.slice();
  view(eocd).setUint32(16, newDirectoryOffset, true);
  const segments: Segment[] = [
    { offset: 0, length: parsed.signingBlockOffset },
    { bytes: header }, ...entries.map(bytes => ({ bytes })), { bytes: footer },
    { offset: parsed.centralDirectoryOffset, length: parsed.centralDirectorySize },
    { bytes: eocd },
  ];
  return segmentedFile(source, segments);
}

export async function canonicalApk(source: ByteSource): Promise<MarkedFile> {
  return plan(source, await parseApk(source));
}

export const apkHandler: MarkerHandler = {
  async mark(source, marker) {
    if (!(marker instanceof Uint8Array) || marker.length < 1 || marker.length > MAX_MARKER_SIZE) {
      fail('MARKER_LIMIT', 'InkParcel marker must contain between 1 byte and 16 KiB.');
    }
    const stableMarker = marker.slice();
    const parsed = await parseApk(source);
    if (parsed.hasMarker) fail('ALREADY_MARKED', 'Upload an original APK without an InkParcel marker.');
    return plan(source, parsed, stableMarker);
  },
  async extract(source) {
    const parsed = await parseApk(source);
    return parsed.pairs.find(pair => pair.id === APK_MARKER_ID)?.bytes.slice(12) ?? null;
  },
};

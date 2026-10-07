export { type ByteRange, type ByteSource, type MarkedFile, type MarkerHandler, MarkingError } from './types';
export { blobSource, MAX_READ_SIZE } from './source';
export {
  apkHandler, inspectApk, type ApkInspection, APK_MARKER_ID, APK_VERITY_PADDING_ID,
  APK_V2_ID, APK_V3_ID, APK_V31_ID, MAX_SIGNING_BLOCK_SIZE, MAX_MARKER_SIZE, MAX_APK_SIZE,
} from './apk';
export { fingerprintApk } from './fingerprint';

import { apkHandler } from './apk';
import { MarkingError, type MarkerHandler } from './types';

const handlers: ReadonlyMap<string, MarkerHandler> = new Map([['apk', apkHandler]]);

export function handlerFor(fileName: string): MarkerHandler {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const handler = extension ? handlers.get(extension) : undefined;
  if (!fileName.includes('.') || !handler) throw new MarkingError('UNSUPPORTED_FORMAT', 'This release supports APK files only.');
  return handler;
}

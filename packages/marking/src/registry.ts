import { apkHandler, assertApkMarkable } from './apk';
import { fingerprintApk } from './fingerprint';
import { MarkingError, type ByteSource, type MarkerHandler } from './types';

/** File-format capabilities; envelope generation stays outside format-specific code. */
export interface FileFormat {
  readonly id: string;
  readonly version: string;
  readonly extensions: readonly string[];
  readonly mediaType: string;
  readonly handler: MarkerHandler;
  readonly fingerprint: (source: ByteSource, onProgress?: (bytes: number, total: number) => void) => Promise<string>;
  readonly assertMarkable: (source: ByteSource) => Promise<void>;
}

// Adding a format only requires its adapter and an entry here. Extensions include
// the leading dot so browsers can use supportedExtensions directly in accept.
const formats: readonly FileFormat[] = [Object.freeze({
  id: 'apk',
  version: 'apk-v1',
  extensions: Object.freeze(['.apk']),
  mediaType: 'application/vnd.android.package-archive',
  handler: apkHandler,
  fingerprint: fingerprintApk,
  assertMarkable: assertApkMarkable,
})];

export const supportedExtensions: readonly string[] = Object.freeze(formats.flatMap(format => [...format.extensions]));
const byExtension = new Map(formats.flatMap(format => format.extensions.map(extension => [extension, format] as const)));

export function formatFor(fileName: string): FileFormat {
  const dot = fileName.lastIndexOf('.');
  const format = dot < 0 ? undefined : byExtension.get(fileName.slice(dot).toLowerCase());
  if (!format) throw new MarkingError('UNSUPPORTED_FORMAT', `Supported file extensions: ${supportedExtensions.join(', ')}.`);
  return format;
}

export function handlerFor(fileName: string): MarkerHandler { return formatFor(fileName).handler; }

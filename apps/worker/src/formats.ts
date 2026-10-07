import { formatFor, MarkingError } from '@inkparcel/marking';
import type { FileRow } from './types';
import { fail } from './validation';

export function selectFormat(fileName: string) {
  try { return formatFor(fileName); }
  catch (error) {
    if (error instanceof MarkingError) fail(415, 'unsupported_format', '不支持此文件格式');
    throw error;
  }
}
export function storedFormat(file: FileRow) {
  const format = selectFormat(file.original_name);
  if (file.handler_version !== format.version) fail(409, 'handler_version_unavailable', '此文件的标记处理器版本不可用，请恢复对应版本');
  return format;
}

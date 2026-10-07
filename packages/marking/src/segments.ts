import { checkRange } from './source';
import { MarkingError, type ByteRange, type ByteSource, type MarkedFile } from './types';

export type Segment = { offset: number; length: number } | { bytes: Uint8Array };

function segmentSize(segment: Segment): number {
  return 'bytes' in segment ? segment.bytes.byteLength : segment.length;
}

/** A stable virtual file. Range offsets always refer to the transformed representation. */
export function segmentedFile(source: ByteSource, segments: readonly Segment[]): MarkedFile {
  const size = segments.reduce((total, segment) => total + segmentSize(segment), 0);
  if (!Number.isSafeInteger(size))
    throw new MarkingError('UNSAFE_SIZE', 'Output size exceeds safe integer limits.');
  return {
    size,
    async stream(range: ByteRange = { offset: 0, length: size }) {
      checkRange(size, range);
      const selected: Segment[] = [];
      let position = 0;
      for (const segment of segments) {
        const length = segmentSize(segment);
        const start = Math.max(position, range.offset);
        const end = Math.min(position + length, range.offset + range.length);
        if (start < end) {
          const skip = start - position;
          selected.push(
            'bytes' in segment
              ? { bytes: segment.bytes.subarray(skip, skip + end - start) }
              : { offset: segment.offset + skip, length: end - start },
          );
        }
        position += length;
      }
      let index = 0;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let remaining = 0;
      let cancelled = false;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            while (!cancelled) {
              if (!reader) {
                const segment = selected[index++];
                if (!segment) {
                  controller.close();
                  return;
                }
                if ('bytes' in segment) {
                  // Do not expose the plan's storage to a consumer that mutates chunks.
                  controller.enqueue(segment.bytes.slice());
                  return;
                }
                remaining = segment.length;
                const stream = await source.stream(segment.offset, segment.length);
                reader = stream.getReader();
                if (cancelled) {
                  await reader.cancel();
                  reader.releaseLock();
                  reader = undefined;
                  return;
                }
              }
              const item = await reader.read();
              if (cancelled) return;
              if (item.done) {
                reader.releaseLock();
                reader = undefined;
                if (remaining !== 0)
                  throw new MarkingError(
                    'TRUNCATED_SOURCE',
                    'The source stream ended before its range was complete.',
                  );
                continue;
              }
              if (!(item.value instanceof Uint8Array) || item.value.byteLength > remaining) {
                throw new MarkingError(
                  'INVALID_SOURCE_STREAM',
                  'The source stream exceeded its requested range.',
                );
              }
              if (item.value.byteLength === 0) continue;
              remaining -= item.value.byteLength;
              controller.enqueue(item.value);
              return;
            }
          } catch (error) {
            if (reader) {
              try {
                await reader.cancel(error);
              } catch {
                /* Preserve the original failure. */
              }
              reader.releaseLock();
              reader = undefined;
            }
            if (!cancelled) controller.error(error);
          }
        },
        async cancel(reason) {
          cancelled = true;
          const active = reader;
          if (active) {
            await active.cancel(reason);
            if (reader === active) {
              active.releaseLock();
              reader = undefined;
            }
          }
        },
      });
    },
  };
}

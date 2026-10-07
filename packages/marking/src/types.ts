export interface ByteRange { offset: number; length: number }

/** The underlying bytes must remain immutable for the lifetime of this source. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  stream(offset: number, length: number): Promise<ReadableStream<Uint8Array>>;
}

export interface MarkedFile {
  size: number;
  stream(range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
}

export interface MarkerHandler {
  mark(source: ByteSource, marker: Uint8Array): Promise<MarkedFile>;
  extract(source: ByteSource): Promise<Uint8Array | null>;
}

export class MarkingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MarkingError';
  }
}

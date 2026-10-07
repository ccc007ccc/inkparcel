import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendUpload, uploadParts, type SavedUpload } from './upload';

afterEach(() => vi.unstubAllGlobals());
describe('resumable multipart upload', () => {
  const saved: SavedUpload = {
    fileId: 'upload-a',
    name: 'sample.apk',
    size: 10,
    lastModified: 0,
    fingerprint: 'a'.repeat(64),
    partSize: 4,
    partCount: 3,
  };
  it('retries a wrong-size part and handles a short final part', () => {
    expect(
      uploadParts(10, 4, [
        { partNumber: 1, size: 4, etag: 'a' },
        { partNumber: 2, size: 3, etag: 'b' },
      ]),
    ).toEqual([
      { number: 1, offset: 0, size: 4, done: true },
      { number: 2, offset: 4, size: 4, done: false },
      { number: 3, offset: 8, size: 2, done: false },
    ]);
  });
  it('sends only missing bytes and completes after all parts are acknowledged', async () => {
    const calls: { path: string; body?: Blob }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options: RequestInit) => {
        calls.push({ path, body: options.body instanceof Blob ? options.body : undefined });
        if (path.endsWith('/upload-a'))
          return Response.json({ ...saved, parts: [{ partNumber: 1, size: 4, etag: 'first' }] });
        return Response.json({ ok: true });
      }),
    );
    const progress: number[] = [];
    await sendUpload(
      '/manage',
      saved,
      new File(['0123456789'], saved.name),
      new AbortController().signal,
      (value) => progress.push(value),
    );
    expect(calls.map((call) => call.path)).toEqual([
      '/manage/api/uploads/upload-a',
      '/manage/api/uploads/upload-a/parts/2',
      '/manage/api/uploads/upload-a/parts/3',
      '/manage/api/uploads/upload-a/complete',
    ]);
    expect(await calls[1].body?.text()).toBe('4567');
    expect(await calls[2].body?.text()).toBe('89');
    expect(progress).toEqual([4, 8, 10]);
  });
  it('does not finalize when a part fails, preserving the server session for retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...saved, parts: [] }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'temporary', message: '请重试' } }, { status: 503 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      sendUpload(
        '/manage',
        saved,
        new File(['0123456789'], saved.name),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('请重试');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('halts between parts when paused without completing the upload', async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...saved, parts: [] }))
      .mockImplementationOnce(async () => {
        controller.abort();
        return Response.json({ ok: true });
      });
    vi.stubGlobal('fetch', fetch);
    await expect(
      sendUpload(
        '/manage',
        saved,
        new File(['0123456789'], saved.name),
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects an upload session belonging to a different file size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...saved, partCount: 7, parts: [] })),
    );
    await expect(
      sendUpload(
        '/manage',
        saved,
        new File(['0123456789'], saved.name),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('不匹配');
  });
});

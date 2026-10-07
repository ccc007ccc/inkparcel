import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  authExpiredEvent,
  base64url,
  descendants,
  folderTrail,
  passwordKey,
  passwordSalt,
  query,
  unbase64url,
  type Folder,
} from './lib';

afterEach(() => vi.unstubAllGlobals());
describe('browser password protocol', () => {
  it('derives the expected 600,000-iteration PBKDF2-SHA256 key', async () => {
    // Independently produced with Python hashlib.pbkdf2_hmac, 32 output bytes.
    const salt = base64url(Uint8Array.from({ length: 16 }, (_, index) => index));
    expect(await passwordKey('correct horse battery staple', salt)).toBe(
      '7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY',
    );
  });
  it('uses distinct random salts and reversible unpadded base64url', () => {
    const first = passwordSalt(),
      second = passwordSalt();
    expect(first).not.toEqual(second);
    expect(unbase64url(first)).toHaveLength(16);
    expect(base64url(unbase64url(first))).toBe(first);
    expect(() => unbase64url('invalid!')).toThrow();
  });
});
describe('API responses', () => {
  it('keeps server validation errors actionable without leaking request bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'key_disabled', message: '这把密钥已停用。' } },
            { status: 403 },
          ),
        ),
    );
    await expect(api('/api/files')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'key_disabled',
      message: '这把密钥已停用。',
    });
  });
  it('handles non-JSON platform failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
    await expect(api('/api/files')).rejects.toBeInstanceOf(ApiError);
  });
  it('notifies the interface when access is revoked but keeps incorrect passwords in the login form', async () => {
    const target = new EventTarget();
    const expired = vi.fn();
    target.addEventListener(authExpiredEvent, expired);
    vi.stubGlobal('window', target);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: 'invalid_password', message: '密码错误' } },
            { status: 401 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: 'access_revoked', message: '访问权限已停用' } },
            { status: 401 },
          ),
        ),
    );
    await expect(api('/manage/api/login')).rejects.toThrow('密码错误');
    expect(expired).not.toHaveBeenCalled();
    await expect(api('/api/files')).rejects.toThrow('访问权限已停用');
    expect(expired).toHaveBeenCalledOnce();
  });
  it('encodes search inputs without turning them into extra filters', () => {
    expect(query({ q: 'hello&keyId=other', folderId: null, page: 1 })).toBe(
      '?q=hello%26keyId%3Dother&page=1',
    );
  });
});
describe('folder navigation', () => {
  const folders: Folder[] = [
    { id: 'a', name: 'A', parentId: null },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'b' },
    { id: 'd', name: 'D', parentId: null },
  ];
  it('builds ordered breadcrumbs and excludes every descendant from move targets', () => {
    expect(folderTrail(folders, 'c').map((folder) => folder.id)).toEqual(['a', 'b', 'c']);
    expect([...descendants(folders, 'a')]).toEqual(['a', 'b', 'c']);
    expect(folderTrail(folders, null)).toEqual([]);
  });
  it('terminates if malformed data contains a cycle', () => {
    expect(
      folderTrail(
        [
          { id: 'x', name: 'X', parentId: 'y' },
          { id: 'y', name: 'Y', parentId: 'x' },
        ],
        'x',
      ),
    ).toHaveLength(2);
  });
});

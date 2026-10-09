import { beforeEach, describe, expect, it } from 'vitest';
import { env as rawEnv } from 'cloudflare:workers';
import { SELF, applyD1Migrations, createExecutionContext, reset } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { apkHandler, blobSource, fingerprintApk } from '@inkparcel/marking';
import { cleanup } from '../src/cleanup';
import { decode, encode, readMarker } from '../src/crypto';
import { PART_SIZE } from '../src/uploads';
import { app } from '../src/index';
import type { Env } from '../src/types';
import { downloadGrant } from '../src/download-grants';
import { validateDownloadSources } from '../src/download-sources';

const env = rawEnv as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const A = '/control-test';
const passwordKey = encode(new Uint8Array(32).fill(17));
const passwordSalt = encode(new Uint8Array(16).fill(29));
type Json = Record<string, any>;
async function call(
  path: string,
  method = 'GET',
  data?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) {
  const requestHeaders: Record<string, string> = { Origin: 'http://localhost', ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (data !== undefined) requestHeaders['Content-Type'] = 'application/json';
  return SELF.fetch(`http://localhost${path}`, {
    method,
    headers: requestHeaders,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
async function json(response: Response): Promise<Json> {
  return response.json() as Promise<Json>;
}
const cookieOf = (response: Response) => response.headers.get('Set-Cookie')!.split(';')[0];
async function setup(path = A) {
  const response = await call('/api/setup', 'POST', {
    bootstrapToken: env.BOOTSTRAP_TOKEN,
    passwordKey,
    passwordSalt,
    adminPath: path,
  });
  expect(response.status).toBe(201);
  return cookieOf(response);
}
async function createKey(adminCookie: string, name = 'Review team') {
  const response = await call(`${A}/api/keys`, 'POST', { name }, adminCookie);
  expect(response.status).toBe(201);
  return json(response);
}
async function recipient(adminCookie: string, keyId: string, userId = 'recipient@example.test') {
  const result = await json(
    await call(`${A}/api/keys/${keyId}/code`, 'POST', { userId }, adminCookie),
  );
  const login = await call('/api/access', 'POST', { userId, code: result.code });
  expect(login.status).toBe(200);
  return { cookie: cookieOf(login), data: await json(login), code: result.code };
}
function structuralApk(prefixSize = 128): Uint8Array {
  // A structural fixture only: signature preservation is independently tested with real apksigner fixtures.
  const blockSize = 48;
  const cdSize = 46;
  const bytes = new Uint8Array(prefixSize + blockSize + cdSize + 22);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < prefixSize; i++) bytes[i] = i % 251;
  view.setUint32(0, 0x04034b50, true);
  view.setBigUint64(prefixSize, BigInt(blockSize - 8), true);
  view.setBigUint64(prefixSize + 8, 8n, true);
  view.setUint32(prefixSize + 16, 0x7109871a, true);
  view.setUint32(prefixSize + 20, 0x12345678, true);
  view.setBigUint64(prefixSize + blockSize - 24, BigInt(blockSize - 8), true);
  bytes.set(new TextEncoder().encode('APK Sig Block 42'), prefixSize + blockSize - 16);
  view.setUint32(prefixSize + blockSize, 0x02014b50, true);
  const end = prefixSize + blockSize + cdSize;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, cdSize, true);
  view.setUint32(end + 16, prefixSize + blockSize, true);
  return bytes;
}
async function beginUpload(
  adminCookie: string,
  bytes: Uint8Array,
  keyIds: string[],
  folderId?: string,
) {
  const fingerprint = await fingerprintApk(blobSource(new Blob([bytes])));
  const response = await call(
    `${A}/api/uploads`,
    'POST',
    { fileName: 'fixture.apk', size: bytes.length, keyIds, folderId, fingerprint },
    adminCookie,
  );
  expect(response.status).toBe(201);
  const result = await json(response);
  return {
    fileId: result.fileId as string,
    partSize: result.partSize as number,
    partCount: result.partCount as number,
    fingerprint,
  };
}
async function putPart(adminCookie: string, fileId: string, number: number, bytes: Uint8Array) {
  return SELF.fetch(`http://localhost${A}/api/uploads/${fileId}/parts/${number}`, {
    method: 'PUT',
    headers: {
      Cookie: adminCookie,
      Origin: 'http://localhost',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });
}
async function upload(adminCookie: string, bytes: Uint8Array, keyIds: string[], folderId?: string) {
  const session = await beginUpload(adminCookie, bytes, keyIds, folderId);
  for (let i = 0; i < session.partCount; i++)
    expect(
      (
        await putPart(
          adminCookie,
          session.fileId,
          i + 1,
          bytes.slice(i * PART_SIZE, (i + 1) * PART_SIZE),
        )
      ).status,
    ).toBe(200);
  const completed = await call(
    `${A}/api/uploads/${session.fileId}/complete`,
    'POST',
    {},
    adminCookie,
  );
  expect(await completed.clone().text(), String(completed.status)).not.toContain('error');
  expect(completed.status).toBe(200);
  return (await json(completed)).file;
}
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('CDN sources and scoped downloads', () => {
  const cdn = 'https://cdn.example.test';
  const sources = [{ name: 'CDN', origin: cdn }];
  async function configured() {
    const adminCookie = await setup();
    expect(
      (await call(`${A}/api/settings`, 'PATCH', { downloadSources: sources }, adminCookie)).status,
    ).toBe(200);
    const key = await createKey(adminCookie);
    const user = await recipient(adminCookie, key.key.id);
    const file = await upload(adminCookie, structuralApk(), [key.key.id]);
    const issued = await call(
      `/api/files/${file.id}/downloads`,
      'POST',
      { sourceOrigin: cdn },
      user.cookie,
    );
    expect(issued.status).toBe(201);
    return { adminCookie, key, user, file, receipt: await json(issued) };
  }
  it('validates explicit origins and preserves sources across unrelated settings changes', async () => {
    const adminCookie = await setup();
    expect((await call(`${A}/api/settings`, 'PATCH', { downloadSources: sources })).status).toBe(
      401,
    );
    for (const origin of [
      'http://cdn.example.test',
      '//cdn.example.test',
      'https://u:p@cdn.example.test',
      'https://cdn.example.test/path',
      'https://cdn.example.test?x',
      'https://cdn.example.test#x',
      'https://cdn.example.test/..',
      'https://*.example.test',
    ]) {
      expect(() => validateDownloadSources([{ name: 'CDN', origin }])).toThrow();
    }
    expect(() =>
      validateDownloadSources([{ name: 'Local', origin: 'http://localhost:8792' }]),
    ).toThrow();
    expect(
      validateDownloadSources([{ name: 'Local', origin: 'http://localhost:8792' }], true),
    ).toHaveLength(1);
    for (const value of [
      null,
      {},
      [null],
      Array(9).fill(sources[0]),
      [...sources, { name: 'Duplicate', origin: cdn + '/' }],
    ]) {
      expect(
        (await call(`${A}/api/settings`, 'PATCH', { downloadSources: value }, adminCookie)).status,
      ).toBe(400);
    }
    const saved = await call(
      `${A}/api/settings`,
      'PATCH',
      { downloadSources: [{ name: ' CDN ', origin: 'https://CDN.example.test:443/' }] },
      adminCookie,
    );
    expect((await json(saved)).downloadSources).toEqual(sources);
    await call(`${A}/api/settings`, 'PATCH', { siteName: 'Files' }, adminCookie);
    expect((await json(await call('/api/site'))).downloadSources).toEqual(sources);
  });
  it('accepts configured proxy origins without trusting forwarded hosts or enabling cross-site mutations', async () => {
    const adminCookie = await setup();
    const request = (headers: Record<string, string>) =>
      call(`${A}/api/settings`, 'PATCH', { siteName: 'Files' }, adminCookie, headers);
    expect((await request({ Origin: cdn, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(403);
    await call(`${A}/api/settings`, 'PATCH', { downloadSources: sources }, adminCookie);
    expect((await request({ Origin: cdn, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
    for (const headers of [
      { Origin: 'https://evil.example.test', 'X-Forwarded-Host': 'cdn.example.test' },
      { Origin: cdn + '.evil.example.test' },
      { Origin: 'null' },
      { Origin: '' },
      { Origin: cdn, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: cdn, 'Sec-Fetch-Site': 'same-site' },
    ] as Record<string, string>[]) {
      const response = await request(headers);
      expect(response.status).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });
  it('downloads through a rewritten proxy host without cookies, preserving marked bytes and range semantics', async () => {
    const { receipt, user, adminCookie } = await configured();
    const url = new URL(receipt.url);
    expect(url.origin).toBe(cdn);
    const path = url.pathname + url.search;
    const full = await call(path);
    expect(full.status).toBe(200);
    expect(full.headers.get('Cache-Control')).toBe('private, no-store');
    const bytes = new Uint8Array(await full.arrayBuffer());
    expect(bytes.length).toBe(Number(full.headers.get('Content-Length')));
    expect(await apkHandler.extract(blobSource(new Blob([bytes])))).not.toBeNull();
    const direct = await call(url.pathname, 'GET', undefined, user.cookie);
    expect(new Uint8Array(await direct.arrayBuffer())).toEqual(bytes);
    const alternateHost = await SELF.fetch(receipt.url);
    expect(alternateHost.status).toBe(200);
    expect(new Uint8Array(await alternateHost.arrayBuffer())).toEqual(bytes);
    const head = await call(path, 'HEAD', undefined, undefined, { Range: 'bytes=-64' });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get('Content-Length'))).toBe(bytes.length);
    expect(await head.text()).toBe('');
    const partial = await call(path, 'GET', undefined, undefined, {
      Range: 'bytes=-64',
      'If-Range': full.headers.get('ETag')!,
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Length')).toBe('64');
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes.slice(-64));
    const invalid = await call(path, 'GET', undefined, undefined, { Range: 'bytes=999999-' });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('Cache-Control')).toBe('private, no-store');
    expect(
      (await json(await call(`${A}/api/downloads`, 'GET', undefined, adminCookie))).total,
    ).toBe(1);
  });
  it('rejects forged, expired, mis-scoped and unconfigured download credentials', async () => {
    const { receipt, user, file } = await configured();
    const url = new URL(receipt.url);
    for (const change of [
      (u: URL) => u.searchParams.set('token', 'invalid'),
      (u: URL) => u.searchParams.set('expires', String(Number(u.searchParams.get('expires')) + 1)),
      (u: URL) => u.searchParams.set('source', 'https://evil.example.test'),
      (u: URL) => {
        u.pathname = `/api/downloads/${crypto.randomUUID()}`;
      },
    ]) {
      const bad = new URL(url);
      change(bad);
      expect((await call(bad.pathname + bad.search, 'GET', undefined, user.cookie)).status).toBe(
        401,
      );
    }
    const expires = Math.floor(Date.now() / 1000) - 1;
    const token = await downloadGrant(env, receipt.id, cdn, expires);
    expect(
      (
        await call(
          `${url.pathname}?${new URLSearchParams({ source: cdn, expires: String(expires), token })}`,
        )
      ).status,
    ).toBe(401);
    for (const path of ['/api/session', '/api/files', `${A}/api/settings`])
      expect((await call(path + url.search)).status).toBe(401);
    expect((await call(`/api/files/${file.id}/downloads${url.search}`, 'POST', {})).status).toBe(
      401,
    );
    expect(
      (
        await call(
          `/api/files/${file.id}/downloads`,
          'POST',
          { sourceOrigin: 'https://evil.example.test' },
          user.cookie,
        )
      ).status,
    ).toBe(400);
    expect((await call(url.pathname)).status).toBe(401);
  });
  it('rechecks user, key, file ACL and source removal for each bearer range request', async () => {
    const { adminCookie, key, user, file, receipt } = await configured();
    const url = new URL(receipt.url);
    const range = () =>
      call(url.pathname + url.search, 'GET', undefined, undefined, { Range: 'bytes=0-0' });
    for (const [path, revoke, restore, status] of [
      [`/users/${user.data.user.id}`, { blocked: true }, { blocked: false }, 401],
      [`/keys/${key.key.id}`, { enabled: false }, { enabled: true }, 401],
      [`/files/${file.id}`, { keyIds: [] }, { keyIds: [key.key.id] }, 404],
      ['/settings', { downloadSources: [] }, { downloadSources: sources }, 401],
    ] as const) {
      expect((await call(`${A}/api${path}`, 'PATCH', revoke, adminCookie)).status).toBe(200);
      expect((await range()).status).toBe(status);
      expect((await call(`${A}/api${path}`, 'PATCH', restore, adminCookie)).status).toBe(200);
      const restored = await range();
      expect(restored.status).toBe(206);
      await restored.arrayBuffer();
    }
    await call(`${A}/api/files/${file.id}`, 'DELETE', undefined, adminCookie);
    expect((await range()).status).toBe(404);
  });
});

describe('setup, routes and administrator sessions', () => {
  it('preserves multiline recipient notes while rejecting embedded control characters', async () => {
    const adminCookie = await setup();
    const key = await createKey(adminCookie);
    const user = await recipient(adminCookie, key.key.id);
    const response = await call(
      `${A}/api/users/${user.data.user.id}`,
      'PATCH',
      { notes: 'First line\r\nSecond\titem' },
      adminCookie,
    );
    expect(response.status).toBe(200);
    expect((await json(response)).user.notes).toBe('First line\nSecond\titem');
    expect(
      (
        await call(
          `${A}/api/users/${user.data.user.id}`,
          'PATCH',
          { notes: 'hidden\u0000control' },
          adminCookie,
        )
      ).status,
    ).toBe(400);
  });
  it('rejects malformed Unicode identities and filenames before storing unusable values', async () => {
    const adminCookie = await setup();
    const key = await createKey(adminCookie);
    for (const malformed of ['\ud800', '\udfff']) {
      expect(
        (
          await call(
            `${A}/api/keys/${key.key.id}/code`,
            'POST',
            { userId: `user${malformed}` },
            adminCookie,
          )
        ).status,
      ).toBe(400);
      expect(
        (await call('/api/access', 'POST', { userId: malformed, code: 'invalid' })).status,
      ).toBe(400);
      expect(
        (
          await call(
            `${A}/api/uploads`,
            'POST',
            { fileName: `${malformed}.apk`, size: 128, fingerprint: '0'.repeat(64), keyIds: [] },
            adminCookie,
          )
        ).status,
      ).toBe(400);
    }
    const valid = await recipient(adminCookie, key.key.id, 'Reader 🚀');
    expect(valid.data.user.userId).toBe('Reader 🚀');
  });
  it('requires HTTPS outside explicit local loopback and never redirects credential POSTs', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    const redirect = await app.fetch(
      new Request('http://localhost:8787/admin?test=1'),
      production,
      createExecutionContext(),
    );
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('Location')).toBe('https://localhost:8787/admin?test=1');
    expect(await redirect.text()).toBe('');
    const insecure = await app.fetch(
      new Request('http://localhost/api/setup', { method: 'POST', body: '{}' }),
      production,
      createExecutionContext(),
    );
    expect(insecure.status).toBe(400);
    expect(insecure.headers.has('Location')).toBe(false);
    expect((await json(insecure)).error.code).toBe('https_required');
    const remoteLocal = await app.fetch(
      new Request('http://example.test/admin'),
      env,
      createExecutionContext(),
    );
    expect(remoteLocal.status).toBe(308);
    const secure = await app.fetch(
      new Request('https://example.test/api/setup', {
        method: 'POST',
        headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bootstrapToken: env.BOOTSTRAP_TOKEN,
          passwordKey,
          passwordSalt,
          adminPath: A,
        }),
      }),
      production,
      createExecutionContext(),
    );
    expect(secure.status).toBe(201);
    expect(secure.headers.get('Set-Cookie')).toContain('; Secure');
  });
  it('requires the deployment token and atomically chooses one administrator', async () => {
    expect((await call('/admin')).status).toBe(200);
    expect(
      (
        await call('/api/setup', 'POST', {
          bootstrapToken: 'wrong',
          passwordKey,
          passwordSalt,
          adminPath: A,
        })
      ).status,
    ).toBe(403);
    const attempts = await Promise.all(
      [A, '/second-path'].map((adminPath) =>
        call('/api/setup', 'POST', {
          bootstrapToken: env.BOOTSTRAP_TOKEN,
          passwordKey,
          passwordSalt,
          adminPath,
        }),
      ),
    );
    expect(attempts.filter((response) => response.status === 201)).toHaveLength(1);
    const winner = attempts.find((response) => response.status === 201)!;
    const path = (await json(winner)).adminPath;
    expect((await call('/admin')).status).toBe(404);
    expect((await call('/api/setup')).status).toBe(404);
    expect((await call('/unknown-page')).status).toBe(404);
    expect((await call(`${path}/api/auth`)).status).toBe(200);
    expect((await call('/api/site')).headers.get('Cache-Control')).toContain('no-store');
    expect(await (await call('/api/site')).text()).not.toContain(path);
  });
  it('rejects cross-origin mutations and invalidates old cookies after password change', async () => {
    const adminCookie = await setup();
    expect(
      (
        await call(`${A}/api/keys`, 'POST', { name: 'bad' }, adminCookie, {
          Origin: 'https://attacker.invalid',
        })
      ).status,
    ).toBe(403);
    const newKey = encode(new Uint8Array(32).fill(31));
    expect(
      (
        await call(
          `${A}/api/password`,
          'POST',
          { currentPasswordKey: passwordKey, passwordKey: newKey, passwordSalt },
          adminCookie,
        )
      ).status,
    ).toBe(200);
    expect((await call(`${A}/api/keys`, 'GET', undefined, adminCookie)).status).toBe(401);
    expect((await call(`${A}/api/login`, 'POST', { passwordKey })).status).toBe(401);
    const login = await call(`${A}/api/login`, 'POST', { passwordKey: newKey });
    expect(login.status).toBe(200);
    const changed = await call(
      `${A}/api/settings`,
      'PATCH',
      { adminPath: '/new-admin-path' },
      cookieOf(login),
    );
    expect(changed.status).toBe(200);
    expect((await call(`${A}/api/auth`)).status).toBe(404);
    expect((await call('/new-admin-path/api/keys', 'GET', undefined, cookieOf(login))).status).toBe(
      200,
    );
  });
});

describe('authorized files and stable marked transfers', () => {
  it('preserves the registered download extension after display names are changed', async () => {
    const adminCookie = await setup();
    const key = await createKey(adminCookie);
    const file = await upload(adminCookie, structuralApk(), [key.key.id]);
    const user = await recipient(adminCookie, key.key.id);
    const original = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    await call(`${A}/api/files/${file.id}`, 'PATCH', { name: '预览版本' }, adminCookie);
    const listing = await json(await call('/api/files', 'GET', undefined, user.cookie));
    expect(listing.files[0].name).toBe('预览版本');
    const receipt = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    expect(receipt.fileName).toBe('预览版本.apk');
    const response = await call(receipt.url, 'GET', undefined, user.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
    );
    const marker = await apkHandler.extract(blobSource(new Blob([await response.arrayBuffer()])));
    expect(readMarker(new TextDecoder().decode(marker!)).claims.name).toBe(receipt.fileName);
    const stored = await env.DB.prepare('SELECT signed_name FROM downloads WHERE id = ?')
      .bind(receipt.id)
      .first<{ signed_name: string }>();
    expect(stored!.signed_name).toBe(receipt.fileName);
    const oldHead = await call(original.url, 'HEAD', undefined, user.cookie);
    expect(oldHead.headers.get('Content-Disposition')).toContain('filename="fixture.apk"');
    await call(`${A}/api/files/${file.id}`, 'PATCH', { name: 'NEXT.APK' }, adminCookie);
    const alreadySuffixed = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    expect(alreadySuffixed.fileName).toBe('NEXT.APK');
  });
  it('pins the registered format version and rejects a silent handler change', async () => {
    const adminCookie = await setup();
    const key = await createKey(adminCookie);
    const file = await upload(adminCookie, structuralApk(), [key.key.id]);
    const stored = await env.DB.prepare('SELECT handler_version FROM files WHERE id = ?')
      .bind(file.id)
      .first<{ handler_version: string }>();
    expect(stored!.handler_version).toBe('apk-v1');
    const user = await recipient(adminCookie, key.key.id);
    await call(`${A}/api/files/${file.id}`, 'PATCH', { name: 'renamed.data' }, adminCookie);
    const receipt = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    const head = await call(receipt.url, 'HEAD', undefined, user.cookie);
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('application/vnd.android.package-archive');
    await env.DB.prepare(
      "UPDATE files SET handler_version = 'unavailable-test-version' WHERE id = ?",
    )
      .bind(file.id)
      .run();
    expect((await call(receipt.url, 'GET', undefined, user.cookie)).status).toBe(409);
    expect((await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie)).status).toBe(
      409,
    );
    expect(
      (await call(`${A}/api/uploads/${file.id}/complete`, 'POST', {}, adminCookie)).status,
    ).toBe(409);
  });
  it('creates and updates 100-key ACLs atomically without a statement per key', async () => {
    const adminCookie = await setup();
    // These rows are storage/ACL principals only, with no usable test credentials.
    const keys = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      code: index.toString(16).padStart(8, '0'),
      name: `Group ${index}`,
    }));
    await env.DB.prepare(
      `INSERT INTO keys (id, code, name, secret_encrypted, secret_digest, created_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.code'), json_extract(value, '$.name'), 'unused-test-ciphertext', json_extract(value, '$.id'), '2026-01-01T00:00:00.000Z' FROM json_each(?)`,
    )
      .bind(JSON.stringify(keys))
      .run();
    const allIds = keys.map((key) => key.id);
    const folderResponse = await call(
      `${A}/api/folders`,
      'POST',
      { name: 'All groups', defaultKeyIds: allIds },
      adminCookie,
    );
    expect(folderResponse.status).toBe(201);
    const folder = (await json(folderResponse)).folder;
    expect(folder.defaultKeyIds).toHaveLength(100);
    const file = await upload(adminCookie, structuralApk(), allIds, folder.id);
    expect(new Set(file.keyIds)).toEqual(new Set(allIds));
    expect(
      (await call(`${A}/api/files/${file.id}`, 'PATCH', { keyIds: [] }, adminCookie)).status,
    ).toBe(200);
    const changed = await json(
      await call(`${A}/api/files/${file.id}`, 'PATCH', { keyIds: allIds }, adminCookie),
    );
    expect(new Set(changed.file.keyIds)).toEqual(new Set(allIds));
    expect(
      (await call(`${A}/api/folders/${folder.id}`, 'PATCH', { defaultKeyIds: [] }, adminCookie))
        .status,
    ).toBe(200);
    const defaults = await json(
      await call(`${A}/api/folders/${folder.id}`, 'PATCH', { defaultKeyIds: allIds }, adminCookie),
    );
    expect(new Set(defaults.folder.defaultKeyIds)).toEqual(new Set(allIds));
    expect(
      (
        await call(
          `${A}/api/folders/${folder.id}`,
          'PATCH',
          { parentId: folder.id, defaultKeyIds: [] },
          adminCookie,
        )
      ).status,
    ).toBe(409);
    const unchanged = await json(await call(`${A}/api/folders`, 'GET', undefined, adminCookie));
    expect(unchanged.items[0].defaultKeyIds).toHaveLength(100);
  });
  it('isolates active keys, hides folders, resumes identical output, and traces retired keys', async () => {
    const adminCookie = await setup();
    const first = await createKey(adminCookie, 'Alpha');
    const second = await createKey(adminCookie, 'Beta');
    expect(
      (
        await call(
          `${A}/api/keys`,
          'POST',
          { name: 'duplicate', secret: first.secret },
          adminCookie,
        )
      ).status,
    ).toBe(409);
    const folder = (
      await json(
        await call(
          `${A}/api/folders`,
          'POST',
          { name: 'Private', defaultKeyIds: [first.key.id] },
          adminCookie,
        ),
      )
    ).folder;
    const file = await upload(adminCookie, structuralApk(), [first.key.id], folder.id);
    const alpha = await recipient(adminCookie, first.key.id, ' e\u0301@example.test ');
    const beta = await recipient(adminCookie, second.key.id, 'é@example.test');
    expect(alpha.data.user.id).toBe(beta.data.user.id);
    expect((await json(await call('/api/files', 'GET', undefined, beta.cookie))).folders).toEqual(
      [],
    );
    expect(
      (await call(`/api/files?folderId=${folder.id}`, 'GET', undefined, beta.cookie)).status,
    ).toBe(404);
    expect((await call(`/api/files/${file.id}/downloads`, 'POST', {}, beta.cookie)).status).toBe(
      404,
    );
    const listing = await json(
      await call(`/api/files?folderId=${folder.id}`, 'GET', undefined, alpha.cookie),
    );
    expect(listing.files[0].id).toBe(file.id);
    const receipt = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, alpha.cookie),
    );
    expect((await call(receipt.url, 'GET', undefined, beta.cookie)).status).toBe(404);
    const head = await call(receipt.url, 'HEAD', undefined, alpha.cookie);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const rangedHead = await call(receipt.url, 'HEAD', undefined, alpha.cookie, {
      Range: 'bytes=0-9',
    });
    expect(rangedHead.status).toBe(200);
    expect(rangedHead.headers.get('Content-Length')).toBe(head.headers.get('Content-Length'));
    expect(rangedHead.headers.has('Content-Range')).toBe(false);
    const response = await call(receipt.url, 'GET', undefined, alpha.cookie);
    const full = new Uint8Array(await response.arrayBuffer());
    expect(full.length).toBe(Number(head.headers.get('Content-Length')));
    expect(response.headers.get('Content-Length')).toBe(String(full.length));
    expect(response.headers.get('ETag')).toBe(head.headers.get('ETag'));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const partial = await call(receipt.url, 'GET', undefined, alpha.cookie, {
      Range: 'bytes=100-4300',
      'If-Range': head.headers.get('ETag')!,
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Length')).toBe(String(full.slice(100, 4301).length));
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(full.slice(100, 4301));
    const suffix = await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: 'bytes=-32' });
    expect(suffix.headers.get('Content-Length')).toBe('32');
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(full.slice(-32));
    const ignored = await call(receipt.url, 'GET', undefined, alpha.cookie, {
      Range: 'bytes=1-10',
      'If-Range': '"old"',
    });
    expect(ignored.status).toBe(200);
    expect(new Uint8Array(await ignored.arrayBuffer())).toEqual(full);
    for (const range of ['bytes=999999-', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=8-2']) {
      const invalid = await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: range });
      expect(invalid.status).toBe(416);
      expect(invalid.headers.get('Content-Range')).toBe(`bytes */${full.length}`);
    }
    expect(
      (await json(await call(`${A}/api/downloads`, 'GET', undefined, adminCookie))).total,
    ).toBe(1);
    const marker = new TextDecoder().decode(
      (await apkHandler.extract(blobSource(new Blob([full]))))!,
    );
    expect(readMarker(marker).claims.userId).toBe(alpha.data.user.id);
    expect(marker).not.toContain('example.test');
    const fingerprint = await fingerprintApk(blobSource(new Blob([full])));
    expect(fingerprint).toBe(file.fingerprint);
    await call(`${A}/api/keys/${first.key.id}`, 'PATCH', { enabled: false }, adminCookie);
    expect(
      (await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: 'bytes=0-20' })).status,
    ).toBe(401);
    expect(
      (await call('/api/access', 'POST', { userId: 'é@example.test', code: alpha.code })).status,
    ).toBe(401);
    const trace = await json(
      await call(`${A}/api/trace`, 'POST', { marker, fingerprint }, adminCookie),
    );
    expect(trace.authentic).toBe(true);
    expect(trace.contentMatch).toBe(true);
    expect(trace.key.enabled).toBe(false);
    expect(
      (
        await json(
          await call(
            `${A}/api/trace`,
            'POST',
            { marker, fingerprint: '0'.repeat(64) },
            adminCookie,
          ),
        )
      ).contentMatch,
    ).toBe(false);
    const [payload, signature] = marker.split('.');
    const invalidTag = decode(signature);
    invalidTag[0] ^= 1;
    expect(
      (
        await call(
          `${A}/api/trace`,
          'POST',
          { marker: `${payload}.${encode(invalidTag)}` },
          adminCookie,
        )
      ).status,
    ).toBe(422);
    await call(`${A}/api/users/${beta.data.user.id}`, 'PATCH', { blocked: true }, adminCookie);
    expect((await call('/api/files', 'GET', undefined, beta.cookie)).status).toBe(401);
  });
  it('prevents folder cycles and keeps explicit ACLs across moves and default changes', async () => {
    const adminCookie = await setup();
    const key = await createKey(adminCookie);
    const parent = (
      await json(
        await call(
          `${A}/api/folders`,
          'POST',
          { name: 'Parent', defaultKeyIds: [key.key.id] },
          adminCookie,
        ),
      )
    ).folder;
    const child = (
      await json(
        await call(`${A}/api/folders`, 'POST', { name: 'Child', parentId: parent.id }, adminCookie),
      )
    ).folder;
    expect(
      (
        await call(
          `${A}/api/folders/${parent.id}`,
          'PATCH',
          { parentId: child.id, defaultKeyIds: [] },
          adminCookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (await json(await call(`${A}/api/folders`, 'GET', undefined, adminCookie))).items.find(
        (folder: Json) => folder.id === parent.id,
      ).defaultKeyIds,
    ).toEqual([key.key.id]);
    const file = await upload(adminCookie, structuralApk(), [], parent.id);
    const user = await recipient(adminCookie, key.key.id);
    expect((await json(await call('/api/files', 'GET', undefined, user.cookie))).folders).toEqual(
      [],
    );
    await call(
      `${A}/api/files/${file.id}`,
      'PATCH',
      { keyIds: [key.key.id], folderId: child.id },
      adminCookie,
    );
    await call(`${A}/api/folders/${parent.id}`, 'PATCH', { defaultKeyIds: [] }, adminCookie);
    expect(
      (await json(await call(`/api/files?folderId=${child.id}`, 'GET', undefined, user.cookie)))
        .files[0].id,
    ).toBe(file.id);
    const receipt = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    await call(`${A}/api/files/${file.id}`, 'PATCH', { keyIds: [] }, adminCookie);
    expect((await call(receipt.url, 'HEAD', undefined, user.cookie)).status).toBe(404);
    expect(
      (await call(`${A}/api/folders/${child.id}`, 'DELETE', undefined, adminCookie)).status,
    ).toBe(409);
  });
});

describe('multipart lifecycle and retention', () => {
  it('recovers completion after a transient R2 inspection read failure', async () => {
    const adminCookie = await setup();
    const bytes = structuralApk();
    const session = await beginUpload(adminCookie, bytes, []);
    expect((await putPart(adminCookie, session.fileId, 1, bytes)).status).toBe(200);
    const failingBucket = new Proxy(env.BUCKET, {
      get(target, property) {
        if (property === 'get')
          return () => Promise.reject(new Error('Temporary R2 transport failure'));
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const request = new Request(`http://localhost${A}/api/uploads/${session.fileId}/complete`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: adminCookie,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const failed = await app.fetch(
      request,
      { ...env, BUCKET: failingBucket },
      createExecutionContext(),
    );
    expect(failed.status).toBe(503);
    expect(
      (await env.DB.prepare('SELECT state FROM uploads WHERE file_id = ?')
        .bind(session.fileId)
        .first<{ state: string }>())!.state,
    ).toBe('completing');
    expect(await env.BUCKET.head(`artifacts/${session.fileId}`)).not.toBeNull();
    expect(
      (await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, adminCookie)).status,
    ).toBe(200);
  });
  it('streams a full 16 MiB part, retries parts and completion, and retains immutable file versions', async () => {
    const adminCookie = await setup();
    const bytes = structuralApk(PART_SIZE + 50);
    const session = await beginUpload(adminCookie, bytes, []);
    expect(session.partSize).toBe(PART_SIZE);
    expect(session.partCount).toBe(2);
    expect((await putPart(adminCookie, session.fileId, 1, bytes.slice(0, 100))).status).toBe(400);
    expect(
      (await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, adminCookie)).status,
    ).toBe(409);
    expect((await putPart(adminCookie, session.fileId, 1, bytes.slice(0, PART_SIZE))).status).toBe(
      200,
    );
    expect((await putPart(adminCookie, session.fileId, 1, bytes.slice(0, PART_SIZE))).status).toBe(
      200,
    );
    const relogin = await call(`${A}/api/login`, 'POST', { passwordKey });
    const renewed = cookieOf(relogin);
    expect(
      (await json(await call(`${A}/api/uploads/${session.fileId}`, 'GET', undefined, renewed)))
        .parts,
    ).toHaveLength(1);
    expect((await putPart(renewed, session.fileId, 2, bytes.slice(PART_SIZE))).status).toBe(200);
    expect(
      (await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, renewed)).status,
    ).toBe(200);
    expect(
      (await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, renewed)).status,
    ).toBe(200);
    const another = await upload(renewed, structuralApk(), []);
    expect(another.id).not.toBe(session.fileId);
    expect((await json(await call(`${A}/api/files`, 'GET', undefined, renewed))).total).toBe(2);
  }, 20_000);
  it('rejects malformed APKs, aborts pending objects, and clears IPs independently of provenance', async () => {
    const adminCookie = await setup();
    const bytes = structuralApk();
    const session = await beginUpload(adminCookie, bytes, []);
    const corrupt = bytes.slice();
    corrupt.fill(0, corrupt.length - 22);
    expect((await putPart(adminCookie, session.fileId, 1, corrupt)).status).toBe(200);
    expect(
      (await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, adminCookie)).status,
    ).toBe(422);
    expect(
      (await call(`${A}/api/uploads/${session.fileId}`, 'DELETE', undefined, adminCookie)).status,
    ).toBe(200);
    expect(await env.BUCKET.head(`artifacts/${session.fileId}`)).toBeNull();
    const key = await createKey(adminCookie);
    const file = await upload(adminCookie, bytes, [key.key.id]);
    const user = await recipient(adminCookie, key.key.id);
    await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie, {
      'CF-Connecting-IP': '192.0.2.9',
    });
    await env.DB.prepare("UPDATE downloads SET created_at = '2000-01-01T00:00:00.000Z'").run();
    const stale = await beginUpload(adminCookie, bytes, []);
    await env.DB.prepare(
      "UPDATE uploads SET updated_at = '2000-01-01T00:00:00.000Z' WHERE file_id = ?",
    )
      .bind(stale.fileId)
      .run();
    await cleanup(env);
    const record = await env.DB.prepare('SELECT ip, marker FROM downloads').first<{
      ip: string | null;
      marker: string;
    }>();
    expect(record!.ip).toBeNull();
    expect(record!.marker).toBeTruthy();
    expect(
      (await env.DB.prepare('SELECT status FROM files WHERE id = ?')
        .bind(stale.fileId)
        .first<{ status: string }>())!.status,
    ).toBe('deleted');
  });
});

describe('identity deletion preserves provenance', () => {
  it('removes deleted identities from management, revokes access and preserves trace', async () => {
    const adminCookie = await setup();
    const first = await createKey(adminCookie);
    const second = await createKey(adminCookie, 'Remaining key');
    const folder = (
      await json(
        await call(
          `${A}/api/folders`,
          'POST',
          {
            name: 'Shared',
            defaultKeyIds: [first.key.id, second.key.id],
          },
          adminCookie,
        ),
      )
    ).folder;
    const file = await upload(
      adminCookie,
      structuralApk(),
      [first.key.id, second.key.id],
      folder.id,
    );
    const user = await recipient(adminCookie, first.key.id);
    const receipt = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    const full = await (await call(receipt.url, 'GET', undefined, user.cookie)).arrayBuffer();
    const source = blobSource(new Blob([full]));
    const marker = new TextDecoder().decode((await apkHandler.extract(source))!);
    const fingerprint = await fingerprintApk(source);
    expect((await call(`${A}/api/keys/${first.key.id}`, 'DELETE')).status).toBe(401);
    expect(
      (await call(`${A}/api/users/${user.data.user.id}`, 'DELETE', undefined, user.cookie)).status,
    ).toBe(401);
    expect(
      (await call(`${A}/api/keys/${first.key.id}`, 'DELETE', undefined, adminCookie)).status,
    ).toBe(200);
    const keys = await json(await call(`${A}/api/keys`, 'GET', undefined, adminCookie));
    expect(keys.items.map((k: Json) => k.id)).toEqual([second.key.id]);
    expect(
      (await call(`${A}/api/keys/${first.key.id}`, 'PATCH', { enabled: true }, adminCookie)).status,
    ).toBe(404);
    expect(
      (await call(`${A}/api/keys/${first.key.id}/code`, 'POST', { userId: 'other' }, adminCookie))
        .status,
    ).toBe(409);
    expect(
      (await call(receipt.url, 'GET', undefined, user.cookie, { Range: 'bytes=0-9' })).status,
    ).toBe(401);
    expect(
      (await call('/api/access', 'POST', { userId: user.data.user.userId, code: user.code }))
        .status,
    ).not.toBe(200);
    const files = await json(
      await call(`${A}/api/files?folderId=${folder.id}`, 'GET', undefined, adminCookie),
    );
    expect(files.files[0].keyIds).toEqual([second.key.id]);
    const folders = await json(await call(`${A}/api/folders`, 'GET', undefined, adminCookie));
    expect(folders.items[0].defaultKeyIds).toEqual([second.key.id]);
    expect(
      (await call(`${A}/api/files/${file.id}`, 'PATCH', { keyIds: [first.key.id] }, adminCookie))
        .status,
    ).toBe(400);
    const alternate = await recipient(adminCookie, second.key.id);
    expect(
      (await call(`${A}/api/users/${user.data.user.id}`, 'DELETE', undefined, adminCookie)).status,
    ).toBe(200);
    const users = await json(
      await call(`${A}/api/users?q=recipient`, 'GET', undefined, adminCookie),
    );
    expect(users.total).toBe(0);
    expect(users.items).toEqual([]);
    expect(
      (await call(`${A}/api/users/${user.data.user.id}`, 'PATCH', { blocked: false }, adminCookie))
        .status,
    ).toBe(404);
    expect((await call('/api/session', 'GET', undefined, alternate.cookie)).status).toBe(401);
    expect(
      (
        await call('/api/access', 'POST', {
          userId: alternate.data.user.userId,
          code: alternate.code,
        })
      ).status,
    ).toBe(403);
    const trace = await json(
      await call(`${A}/api/trace`, 'POST', { marker, fingerprint }, adminCookie),
    );
    expect(trace.authentic).toBe(true);
    expect(trace.contentMatch).toBe(true);
    expect(trace.user.userId).toBe(user.data.user.userId);
    expect(trace.key.id).toBe(first.key.id);
    expect(
      (await json(await call(`${A}/api/downloads`, 'GET', undefined, adminCookie))).total,
    ).toBe(1);
    // DELETE is safe to retry; neither historical material nor unrelated identities are removed.
    expect(
      (await call(`${A}/api/keys/${first.key.id}`, 'DELETE', undefined, adminCookie)).status,
    ).toBe(200);
    expect(
      (await call(`${A}/api/users/${user.data.user.id}`, 'DELETE', undefined, adminCookie)).status,
    ).toBe(200);
  });
});

describe('custom management paths', () => {
  it('normalizes short plain names and rejects reserved or ambiguous routes', async () => {
    const cookie = await setup(' a ');
    expect((await call('/a/api/settings', 'GET', undefined, cookie)).status).toBe(200);
    for (const invalid of [
      'admin',
      '/API',
      'assets',
      '/downloads',
      '/',
      '//host',
      '/a/b',
      '../a',
      '/a?x',
      '/a#x',
      '/a%2fb',
      '/中文',
      'a'.repeat(65),
    ]) {
      expect((await call('/a/api/settings', 'PATCH', { adminPath: invalid }, cookie)).status).toBe(
        400,
      );
    }
    for (const next of ['manage', '_private', '-private', '8']) {
      const current = (await env.DB.prepare('SELECT admin_path FROM settings WHERE id = 1').first<{
        admin_path: string;
      }>())!.admin_path;
      const result = await call(`${current}/api/settings`, 'PATCH', { adminPath: next }, cookie);
      expect(result.status).toBe(200);
      expect((await json(result)).adminPath).toBe('/' + next);
      expect((await call(current)).status).toBe(404);
      expect((await call('/' + next + '/api/settings', 'GET', undefined, cookie)).status).toBe(200);
    }
  });
});

describe('stealth presentation setting', () => {
  it('is admin-controlled, persists across partial updates and keeps marking enabled', async () => {
    const cookie = await setup();
    expect((await json(await call('/api/site'))).stealthMode).toBe(false);
    expect((await call(`${A}/api/settings`, 'PATCH', { stealthMode: true })).status).toBe(401);
    expect((await call(`${A}/api/settings`, 'PATCH', { stealthMode: 'true' }, cookie)).status).toBe(
      400,
    );
    expect((await call(`${A}/api/settings`, 'PATCH', { stealthMode: true }, cookie)).status).toBe(
      200,
    );
    const englishPage = await (await call('/', 'GET', undefined, 'inkparcel_language=en')).text();
    expect(englishPage).toContain('lang="en"');
    expect(englishPage).toContain('<title>File sharing</title>');
    await call(`${A}/api/settings`, 'PATCH', { siteName: 'Files' }, cookie);
    expect((await json(await call('/api/site'))).stealthMode).toBe(true);
    expect(
      (await json(await call(`${A}/api/settings`, 'GET', undefined, cookie))).stealthMode,
    ).toBe(true);
    const key = await createKey(cookie);
    const file = await upload(cookie, structuralApk(), [key.key.id]);
    const user = await recipient(cookie, key.key.id);
    const receipt = await json(
      await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie),
    );
    const bytes = await (await call(receipt.url, 'GET', undefined, user.cookie)).arrayBuffer();
    const source = blobSource(new Blob([bytes]));
    const marker = new TextDecoder().decode((await apkHandler.extract(source))!);
    const trace = await json(
      await call(
        `${A}/api/trace`,
        'POST',
        { marker, fingerprint: await fingerprintApk(source) },
        cookie,
      ),
    );
    expect(trace.authentic).toBe(true);
    expect(trace.contentMatch).toBe(true);
    expect(trace.user.id).toBe(user.data.user.id);
    await call(`${A}/api/settings`, 'PATCH', { stealthMode: false }, cookie);
    expect((await json(await call('/api/site'))).stealthMode).toBe(false);
  });
});

describe('site branding and icons', () => {
  it('updates escaped HTML titles and validates, serves, replaces and resets icons', async () => {
    const cookie = await setup();
    const title = '分享 <测试> & 文件';
    await call(`${A}/api/settings`, 'PATCH', { siteName: title }, cookie);
    expect((await json(await call('/api/site'))).name).toBe(title);
    const html = await (await call('/')).text();
    expect(html).toContain('分享 &lt;测试&gt; &amp; 文件');
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNwyov4TwlmGDVg1IBRA4aLAQBpQwcfAk27cgAAAABJRU5ErkJggg==',
      ),
      (byte) => byte.charCodeAt(0),
    );
    const put = (bytes: Uint8Array, cookie?: string, contentType = 'image/png') =>
      SELF.fetch(`http://localhost${A}/api/site-icon`, {
        method: 'PUT',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': contentType,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: bytes,
      });
    expect((await put(png)).status).toBe(401);
    expect((await put(png, cookie, 'image/svg+xml')).status).toBe(415);
    expect((await put(new Uint8Array(256 * 1024 + 1), cookie)).status).toBe(413);
    expect((await put(png.slice(0, 20), cookie)).status).toBe(400);
    const oversized = png.slice();
    new DataView(oversized.buffer).setUint32(16, 1025);
    expect((await put(oversized, cookie)).status).toBe(400);
    const first = await json(await put(png, cookie));
    expect(first.hasCustomIcon).toBe(true);
    expect((await json(await call('/api/site'))).hasCustomIcon).toBe(true);
    const icon = await call(first.iconUrl);
    expect(icon.headers.get('Content-Type')).toBe('image/png');
    expect(icon.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await icon.arrayBuffer())).toEqual(png);
    expect((await call(first.iconUrl, 'HEAD')).status).toBe(200);
    expect((await json(await call('/api/site'))).iconUrl).toBe(first.iconUrl);
    const second = await json(await put(png, cookie));
    expect(second.iconUrl).not.toBe(first.iconUrl);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM site_icon').first<{ n: number }>())!.n,
    ).toBe(1);
    expect((await call(`${A}/api/site-icon`, 'DELETE')).status).toBe(401);
    expect((await call(`${A}/api/site-icon`, 'DELETE', undefined, cookie)).status).toBe(200);
    expect(
      (await json(await call(`${A}/api/settings`, 'GET', undefined, cookie))).hasCustomIcon,
    ).toBe(false);
    expect((await call('/api/site-icon')).headers.get('Content-Type')).toBe('image/svg+xml');
    expect((await json(await call('/api/site'))).hasCustomIcon).toBe(false);
  });
});

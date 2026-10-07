import { beforeEach, describe, expect, it } from 'vitest';
import { env as rawEnv } from 'cloudflare:workers';
import { SELF, applyD1Migrations, reset } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { apkHandler, blobSource, fingerprintApk } from '@inkparcel/marking';
import { cleanup } from '../src/cleanup';
import { decode, encode, readMarker } from '../src/crypto';
import { PART_SIZE } from '../src/uploads';
import type { Env } from '../src/types';

const env = rawEnv as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const A = '/control-test';
const passwordKey = encode(new Uint8Array(32).fill(17));
const passwordSalt = encode(new Uint8Array(16).fill(29));
type Json = Record<string, any>;
async function call(path: string, method = 'GET', data?: unknown, cookie?: string, headers?: Record<string, string>) {
  const requestHeaders: Record<string, string> = { Origin: 'http://localhost', ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (data !== undefined) requestHeaders['Content-Type'] = 'application/json';
  return SELF.fetch(`http://localhost${path}`, { method, headers: requestHeaders, body: data === undefined ? undefined : JSON.stringify(data) });
}
async function json(response: Response): Promise<Json> { return response.json() as Promise<Json>; }
const cookieOf = (response: Response) => response.headers.get('Set-Cookie')!.split(';')[0];
async function setup(path = A) {
  const response = await call('/api/setup', 'POST', { bootstrapToken: env.BOOTSTRAP_TOKEN, passwordKey, passwordSalt, adminPath: path });
  expect(response.status).toBe(201); return cookieOf(response);
}
async function createKey(adminCookie: string, name = 'Review team') {
  const response = await call(`${A}/api/keys`, 'POST', { name }, adminCookie); expect(response.status).toBe(201); return json(response);
}
async function recipient(adminCookie: string, keyId: string, userId = 'recipient@example.test') {
  const result = await json(await call(`${A}/api/keys/${keyId}/code`, 'POST', { userId }, adminCookie));
  const login = await call('/api/access', 'POST', { userId, code: result.code }); expect(login.status).toBe(200);
  return { cookie: cookieOf(login), data: await json(login), code: result.code };
}
function structuralApk(prefixSize = 128): Uint8Array {
  // A structural fixture only: signature preservation is independently tested with real apksigner fixtures.
  const blockSize = 48; const cdSize = 46; const bytes = new Uint8Array(prefixSize + blockSize + cdSize + 22); const view = new DataView(bytes.buffer);
  for (let i = 0; i < prefixSize; i++) bytes[i] = i % 251;
  view.setUint32(0, 0x04034b50, true);
  view.setBigUint64(prefixSize, BigInt(blockSize - 8), true);
  view.setBigUint64(prefixSize + 8, 8n, true); view.setUint32(prefixSize + 16, 0x7109871a, true); view.setUint32(prefixSize + 20, 0x12345678, true);
  view.setBigUint64(prefixSize + blockSize - 24, BigInt(blockSize - 8), true);
  bytes.set(new TextEncoder().encode('APK Sig Block 42'), prefixSize + blockSize - 16);
  view.setUint32(prefixSize + blockSize, 0x02014b50, true);
  const end = prefixSize + blockSize + cdSize; view.setUint32(end, 0x06054b50, true); view.setUint16(end + 8, 1, true); view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, cdSize, true); view.setUint32(end + 16, prefixSize + blockSize, true); return bytes;
}
async function beginUpload(adminCookie: string, bytes: Uint8Array, keyIds: string[], folderId?: string) {
  const fingerprint = await fingerprintApk(blobSource(new Blob([bytes])));
  const response = await call(`${A}/api/uploads`, 'POST', { fileName: 'fixture.apk', size: bytes.length, keyIds, folderId, fingerprint }, adminCookie);
  expect(response.status).toBe(201); const result = await json(response);
  return { fileId: result.fileId as string, partSize: result.partSize as number, partCount: result.partCount as number, fingerprint };
}
async function putPart(adminCookie: string, fileId: string, number: number, bytes: Uint8Array) {
  return SELF.fetch(`http://localhost${A}/api/uploads/${fileId}/parts/${number}`, {
    method: 'PUT', headers: { Cookie: adminCookie, Origin: 'http://localhost', 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) }, body: bytes
  });
}
async function upload(adminCookie: string, bytes: Uint8Array, keyIds: string[], folderId?: string) {
  const session = await beginUpload(adminCookie, bytes, keyIds, folderId);
  for (let i = 0; i < session.partCount; i++) expect((await putPart(adminCookie, session.fileId, i + 1, bytes.slice(i * PART_SIZE, (i + 1) * PART_SIZE))).status).toBe(200);
  const completed = await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, adminCookie);
  expect(await completed.clone().text(), String(completed.status)).not.toContain('error'); expect(completed.status).toBe(200); return (await json(completed)).file;
}
beforeEach(async () => { await reset(); await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

describe('setup, routes and administrator sessions', () => {
  it('requires the deployment token and atomically chooses one administrator', async () => {
    expect((await call('/admin')).status).toBe(200);
    expect((await call('/api/setup', 'POST', { bootstrapToken: 'wrong', passwordKey, passwordSalt, adminPath: A })).status).toBe(403);
    const attempts = await Promise.all([A, '/second-path'].map(adminPath => call('/api/setup', 'POST', { bootstrapToken: env.BOOTSTRAP_TOKEN, passwordKey, passwordSalt, adminPath })));
    expect(attempts.filter(response => response.status === 201)).toHaveLength(1);
    const winner = attempts.find(response => response.status === 201)!; const path = (await json(winner)).adminPath;
    expect((await call('/admin')).status).toBe(404);
    expect((await call('/api/setup')).status).toBe(404);
    expect((await call('/unknown-page')).status).toBe(404);
    expect((await call(`${path}/api/auth`)).status).toBe(200);
    expect((await call('/api/site')).headers.get('Cache-Control')).toContain('no-store');
    expect(await (await call('/api/site')).text()).not.toContain(path);
  });
  it('rejects cross-origin mutations and invalidates old cookies after password change', async () => {
    const adminCookie = await setup();
    expect((await call(`${A}/api/keys`, 'POST', { name: 'bad' }, adminCookie, { Origin: 'https://attacker.invalid' })).status).toBe(403);
    const newKey = encode(new Uint8Array(32).fill(31));
    expect((await call(`${A}/api/password`, 'POST', { currentPasswordKey: passwordKey, passwordKey: newKey, passwordSalt }, adminCookie)).status).toBe(200);
    expect((await call(`${A}/api/keys`, 'GET', undefined, adminCookie)).status).toBe(401);
    expect((await call(`${A}/api/login`, 'POST', { passwordKey })).status).toBe(401);
    const login = await call(`${A}/api/login`, 'POST', { passwordKey: newKey }); expect(login.status).toBe(200);
    const changed = await call(`${A}/api/settings`, 'PATCH', { adminPath: '/new-admin-path' }, cookieOf(login)); expect(changed.status).toBe(200);
    expect((await call(`${A}/api/auth`)).status).toBe(404);
    expect((await call('/new-admin-path/api/keys', 'GET', undefined, cookieOf(login))).status).toBe(200);
  });
});

describe('authorized files and stable marked transfers', () => {
  it('isolates active keys, hides folders, resumes identical output, and traces retired keys', async () => {
    const adminCookie = await setup(); const first = await createKey(adminCookie, 'Alpha'); const second = await createKey(adminCookie, 'Beta');
    expect((await call(`${A}/api/keys`, 'POST', { name: 'duplicate', secret: first.secret }, adminCookie)).status).toBe(409);
    const folder = (await json(await call(`${A}/api/folders`, 'POST', { name: 'Private', defaultKeyIds: [first.key.id] }, adminCookie))).folder;
    const file = await upload(adminCookie, structuralApk(), [first.key.id], folder.id);
    const alpha = await recipient(adminCookie, first.key.id, ' e\u0301@example.test '); const beta = await recipient(adminCookie, second.key.id, 'é@example.test');
    expect(alpha.data.user.id).toBe(beta.data.user.id);
    expect((await json(await call('/api/files', 'GET', undefined, beta.cookie))).folders).toEqual([]);
    expect((await call(`/api/files?folderId=${folder.id}`, 'GET', undefined, beta.cookie)).status).toBe(404);
    expect((await call(`/api/files/${file.id}/downloads`, 'POST', {}, beta.cookie)).status).toBe(404);
    const listing = await json(await call(`/api/files?folderId=${folder.id}`, 'GET', undefined, alpha.cookie)); expect(listing.files[0].id).toBe(file.id);
    const receipt = await json(await call(`/api/files/${file.id}/downloads`, 'POST', {}, alpha.cookie));
    expect((await call(receipt.url, 'GET', undefined, beta.cookie)).status).toBe(404);
    const head = await call(receipt.url, 'HEAD', undefined, alpha.cookie); expect(head.status).toBe(200); expect(await head.text()).toBe('');
    const response = await call(receipt.url, 'GET', undefined, alpha.cookie); const full = new Uint8Array(await response.arrayBuffer());
    expect(full.length).toBe(Number(head.headers.get('Content-Length'))); expect(response.headers.get('ETag')).toBe(head.headers.get('ETag'));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const partial = await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: 'bytes=100-4300', 'If-Range': head.headers.get('ETag')! });
    expect(partial.status).toBe(206); expect(new Uint8Array(await partial.arrayBuffer())).toEqual(full.slice(100, 4301));
    const suffix = await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: 'bytes=-32' }); expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(full.slice(-32));
    const ignored = await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: 'bytes=1-10', 'If-Range': '"old"' }); expect(ignored.status).toBe(200); expect(new Uint8Array(await ignored.arrayBuffer())).toEqual(full);
    for (const range of ['bytes=999999-', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=8-2']) { const invalid = await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: range }); expect(invalid.status).toBe(416); expect(invalid.headers.get('Content-Range')).toBe(`bytes */${full.length}`); }
    expect((await json(await call(`${A}/api/downloads`, 'GET', undefined, adminCookie))).total).toBe(1);
    const marker = new TextDecoder().decode((await apkHandler.extract(blobSource(new Blob([full]))))!);
    expect(readMarker(marker).claims.userId).toBe(alpha.data.user.id); expect(marker).not.toContain('example.test');
    const fingerprint = await fingerprintApk(blobSource(new Blob([full]))); expect(fingerprint).toBe(file.fingerprint);
    await call(`${A}/api/keys/${first.key.id}`, 'PATCH', { enabled: false }, adminCookie);
    expect((await call(receipt.url, 'GET', undefined, alpha.cookie, { Range: 'bytes=0-20' })).status).toBe(401);
    expect((await call('/api/access', 'POST', { userId: 'é@example.test', code: alpha.code })).status).toBe(401);
    const trace = await json(await call(`${A}/api/trace`, 'POST', { marker, fingerprint }, adminCookie)); expect(trace.authentic).toBe(true); expect(trace.contentMatch).toBe(true); expect(trace.key.enabled).toBe(false);
    expect((await json(await call(`${A}/api/trace`, 'POST', { marker, fingerprint: '0'.repeat(64) }, adminCookie))).contentMatch).toBe(false);
    const [payload, signature] = marker.split('.'); const invalidTag = decode(signature); invalidTag[0] ^= 1;
    expect((await call(`${A}/api/trace`, 'POST', { marker: `${payload}.${encode(invalidTag)}` }, adminCookie)).status).toBe(422);
    await call(`${A}/api/users/${beta.data.user.id}`, 'PATCH', { blocked: true }, adminCookie);
    expect((await call('/api/files', 'GET', undefined, beta.cookie)).status).toBe(401);
  });
  it('prevents folder cycles and keeps explicit ACLs across moves and default changes', async () => {
    const adminCookie = await setup(); const key = await createKey(adminCookie);
    const parent = (await json(await call(`${A}/api/folders`, 'POST', { name: 'Parent', defaultKeyIds: [key.key.id] }, adminCookie))).folder;
    const child = (await json(await call(`${A}/api/folders`, 'POST', { name: 'Child', parentId: parent.id }, adminCookie))).folder;
    expect((await call(`${A}/api/folders/${parent.id}`, 'PATCH', { parentId: child.id, defaultKeyIds: [] }, adminCookie)).status).toBe(409);
    expect((await json(await call(`${A}/api/folders`, 'GET', undefined, adminCookie))).items.find((folder: Json) => folder.id === parent.id).defaultKeyIds).toEqual([key.key.id]);
    const file = await upload(adminCookie, structuralApk(), [], parent.id); const user = await recipient(adminCookie, key.key.id);
    expect((await json(await call('/api/files', 'GET', undefined, user.cookie))).folders).toEqual([]);
    await call(`${A}/api/files/${file.id}`, 'PATCH', { keyIds: [key.key.id], folderId: child.id }, adminCookie);
    await call(`${A}/api/folders/${parent.id}`, 'PATCH', { defaultKeyIds: [] }, adminCookie);
    expect((await json(await call(`/api/files?folderId=${child.id}`, 'GET', undefined, user.cookie))).files[0].id).toBe(file.id);
    const receipt = await json(await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie));
    await call(`${A}/api/files/${file.id}`, 'PATCH', { keyIds: [] }, adminCookie);
    expect((await call(receipt.url, 'HEAD', undefined, user.cookie)).status).toBe(404);
    expect((await call(`${A}/api/folders/${child.id}`, 'DELETE', undefined, adminCookie)).status).toBe(409);
  });
});

describe('multipart lifecycle and retention', () => {
  it('streams a full 16 MiB part, retries parts and completion, and retains immutable file versions', async () => {
    const adminCookie = await setup(); const bytes = structuralApk(PART_SIZE + 50); const session = await beginUpload(adminCookie, bytes, []);
    expect(session.partSize).toBe(PART_SIZE); expect(session.partCount).toBe(2);
    expect((await putPart(adminCookie, session.fileId, 1, bytes.slice(0, 100))).status).toBe(400);
    expect((await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, adminCookie)).status).toBe(409);
    expect((await putPart(adminCookie, session.fileId, 1, bytes.slice(0, PART_SIZE))).status).toBe(200);
    expect((await putPart(adminCookie, session.fileId, 1, bytes.slice(0, PART_SIZE))).status).toBe(200);
    const relogin = await call(`${A}/api/login`, 'POST', { passwordKey }); const renewed = cookieOf(relogin);
    expect((await json(await call(`${A}/api/uploads/${session.fileId}`, 'GET', undefined, renewed))).parts).toHaveLength(1);
    expect((await putPart(renewed, session.fileId, 2, bytes.slice(PART_SIZE))).status).toBe(200);
    expect((await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, renewed)).status).toBe(200);
    expect((await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, renewed)).status).toBe(200);
    const another = await upload(renewed, structuralApk(), []); expect(another.id).not.toBe(session.fileId);
    expect((await json(await call(`${A}/api/files`, 'GET', undefined, renewed))).total).toBe(2);
  });
  it('rejects malformed APKs, aborts pending objects, and clears IPs independently of provenance', async () => {
    const adminCookie = await setup(); const bytes = structuralApk(); const session = await beginUpload(adminCookie, bytes, []);
    const corrupt = bytes.slice(); corrupt.fill(0, corrupt.length - 22);
    expect((await putPart(adminCookie, session.fileId, 1, corrupt)).status).toBe(200);
    expect((await call(`${A}/api/uploads/${session.fileId}/complete`, 'POST', {}, adminCookie)).status).toBe(422);
    expect((await call(`${A}/api/uploads/${session.fileId}`, 'DELETE', undefined, adminCookie)).status).toBe(200);
    expect(await env.BUCKET.head(`artifacts/${session.fileId}`)).toBeNull();
    const key = await createKey(adminCookie); const file = await upload(adminCookie, bytes, [key.key.id]); const user = await recipient(adminCookie, key.key.id);
    await call(`/api/files/${file.id}/downloads`, 'POST', {}, user.cookie, { 'CF-Connecting-IP': '192.0.2.9' });
    await env.DB.prepare("UPDATE downloads SET created_at = '2000-01-01T00:00:00.000Z'").run();
    const stale = await beginUpload(adminCookie, bytes, []); await env.DB.prepare("UPDATE uploads SET updated_at = '2000-01-01T00:00:00.000Z' WHERE file_id = ?").bind(stale.fileId).run();
    await cleanup(env);
    const record = await env.DB.prepare('SELECT ip, marker FROM downloads').first<{ip: string | null; marker: string}>(); expect(record!.ip).toBeNull(); expect(record!.marker).toBeTruthy();
    expect((await env.DB.prepare('SELECT status FROM files WHERE id = ?').bind(stale.fileId).first<{status: string}>())!.status).toBe('deleted');
  });
});

import type { Env, MarkerClaims, Session } from './types';
import { fail } from './validation';

const encoder = new TextEncoder();
export const utf8 = (value: string) => encoder.encode(value);
export function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(value: unknown, min = 0, max = 4096): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil((max * 4) / 3) ||
    !/^[A-Za-z0-9_-]*$/.test(value)
  )
    fail(400, 'invalid_encoding', '编码格式无效');
  let result: Uint8Array;
  try {
    result = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    fail(400, 'invalid_encoding', '编码格式无效');
  }
  if (result.length < min || result.length > max || encode(result) !== value)
    fail(400, 'invalid_encoding', '编码长度无效');
  return result;
}
const owned = (value: Uint8Array): ArrayBuffer => new Uint8Array(value).buffer;
export async function hmac(secret: Uint8Array, message: string | Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    owned(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      owned(typeof message === 'string' ? utf8(message) : message),
    ),
  );
}
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}
export async function appKey(env: Env, purpose: string) {
  if (!env.APP_SECRET) fail(503, 'configuration_required', '服务尚未配置');
  let secret: Uint8Array;
  try {
    secret = decode(env.APP_SECRET, 32, 32);
  } catch {
    fail(503, 'configuration_required', '服务密钥配置无效');
  }
  return hmac(secret, `inkparcel:v1:${purpose}`);
}
export async function keyedValue(env: Env, purpose: string, value: string) {
  return encode(await hmac(await appKey(env, purpose), value));
}
export async function passwordVerifier(env: Env, value: unknown) {
  const key = decode(value, 32, 32);
  return encode(await hmac(await appKey(env, 'password-verifier'), key));
}
export async function encryptSecret(env: Env, secret: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    owned(await appKey(env, 'key-encryption')),
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: owned(iv), additionalData: owned(utf8('inkparcel:key:v1')) },
    key,
    owned(secret),
  );
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decryptSecret(env: Env, value: string): Promise<Uint8Array> {
  const parts = value.split('.');
  if (parts.length !== 2) fail(500, 'secret_unavailable', '无法读取密钥');
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      owned(await appKey(env, 'key-encryption')),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: owned(decode(parts[0], 12, 12)),
          additionalData: owned(utf8('inkparcel:key:v1')),
        },
        key,
        owned(decode(parts[1], 48, 48)),
      ),
    );
  } catch {
    fail(500, 'secret_unavailable', '无法读取密钥，请检查服务密钥与备份');
  }
}
export async function accessCode(
  secret: Uint8Array,
  keyId: string,
  keyCode: string,
  userId: string,
) {
  const codeKey = await hmac(secret, 'inkparcel:v1:access-code');
  const tag = await hmac(codeKey, JSON.stringify([keyId, userId]));
  return `${keyCode}.${encode(tag.slice(0, 16))}`;
}
export async function signSession(env: Env, session: Session) {
  const payload = encode(utf8(JSON.stringify(session)));
  return `${payload}.${encode(await hmac(await appKey(env, 'session'), payload))}`;
}
export async function parseSession(env: Env, token: string | undefined): Promise<Session | null> {
  if (!token || token.length > 2048) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    if (!equal(decode(parts[1], 32, 32), await hmac(await appKey(env, 'session'), parts[0])))
      return null;
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decode(parts[0], 1, 1024)),
    ) as Session;
    if (
      !value ||
      !['admin', 'recipient'].includes(value.kind) ||
      !Number.isSafeInteger(value.exp) ||
      value.exp <= Math.floor(Date.now() / 1000) ||
      typeof value.sid !== 'string'
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export async function signMarker(secret: Uint8Array, claims: MarkerClaims): Promise<string> {
  const payload = encode(utf8(JSON.stringify(claims)));
  return `${payload}.${encode(await hmac(await hmac(secret, 'inkparcel:v1:marker'), payload))}`;
}
export function readMarker(marker: unknown): {
  payload: string;
  tag: Uint8Array;
  claims: MarkerClaims;
} {
  if (typeof marker !== 'string' || marker.length > 8192)
    fail(400, 'malformed_marker', '标记格式无效');
  const parts = marker.split('.');
  if (parts.length !== 2) fail(400, 'malformed_marker', '标记格式无效');
  try {
    const claims = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decode(parts[0], 1, 4096)),
    );
    if (!claims || claims.v !== 1) fail(400, 'unsupported_marker', '不支持的标记版本');
    for (const key of [
      'issuanceId',
      'userId',
      'keyId',
      'fileId',
      'fingerprint',
      'name',
      'issuedAt',
    ])
      if (typeof claims[key] !== 'string') fail(400, 'malformed_marker', '标记字段无效');
    return { payload: parts[0], tag: decode(parts[1], 32, 32), claims };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'unsupported_marker')
      throw error;
    fail(400, 'malformed_marker', '标记格式无效');
  }
}
export async function verifyMarker(secret: Uint8Array, marker: ReturnType<typeof readMarker>) {
  return equal(marker.tag, await hmac(await hmac(secret, 'inkparcel:v1:marker'), marker.payload));
}

# HTTP and shared module contracts

This document fixes the v0.1 interface shared by the Worker and browser. JSON
success bodies are direct objects; errors are `{error:{code,message}}`. Mutating
requests require a same-origin `Origin` header, JSON except upload parts, and the
appropriate HttpOnly cookie. All timestamps are ISO 8601 UTC. IDs are opaque strings.

## Routing and authentication

`A` below is the configured admin path (for example `/control-random`); it must never
be compiled into frontend assets or returned by public discovery APIs.

| Method / path | Request | Response |
| --- | --- | --- |
| GET `/api/site` | — | `{name, initialized}` |
| GET `/api/setup` | — | `{available:true}` only before setup, otherwise 404 |
| POST `/api/setup` | `{bootstrapToken,passwordKey,passwordSalt,adminPath}` | `{adminPath}` + admin cookie |
| GET `A/api/auth` | — | `{authenticated,passwordSalt,kdf:{algorithm:"PBKDF2-SHA256",iterations:600000}}` |
| POST `A/api/login` | `{passwordKey}` | `{ok:true}` + admin cookie |
| POST `A/api/logout` | — | `{ok:true}` + cleared cookie |
| POST `/api/access` | `{userId,code}` | `{user:{id,userId},key:{id,name}}` + recipient cookie |
| GET `/api/session` | — | same session object or 401 |
| POST `/api/logout` | — | `{ok:true}` + cleared recipient cookie |

`passwordKey` and `passwordSalt` are unpadded base64url: 32 derived bytes and at
least 16 random salt bytes, respectively. The frontend derives the password key
using WebCrypto PBKDF2-SHA256 (600,000 iterations, 256 output bits).

## Recipient library

| Method / path | Request | Response |
| --- | --- | --- |
| GET `/api/files` | `folderId` optional, `page` default 1 | `{files,folders,breadcrumbs,total,page,pageSize}` |
| POST `/api/files/:id/downloads` | `{}` | `{id,url,fileName}` |
| GET / HEAD `/api/downloads/:id` | standard HTTP range headers | personalized attachment stream |

Public file objects: `{id,name,size,uploadedAt}`. Folder objects:
`{id,name,parentId}`. Breadcrumbs contain ancestor folder objects. Only visible
files/folders are returned. Root is `folderId=null` (omit query parameter).

Downloads are bound to the recipient session's user AND key. Byte ranges refer to
the personalized bytes. Authentication/authorization is checked on every request.

## Administration

All following paths are prefixed with `A/api` and require admin authentication.

| Method / path | Request | Response |
| --- | --- | --- |
| GET `/keys` | — | `{items:Key[]}` |
| POST `/keys` | `{name,secret?}`; omitted secret generates 32 bytes | `{key:Key,secret}` (secret displayed once) |
| PATCH `/keys/:id` | `{name?,enabled?}` | `{key:Key}` |
| POST `/keys/:id/code` | `{userId}` | `{userId,code}` |
| GET `/folders` | — | `{items:Folder[]}` |
| POST `/folders` | `{name,parentId?,defaultKeyIds?}` | `{folder:Folder}` |
| PATCH `/folders/:id` | `{name?,parentId?,defaultKeyIds?}` | `{folder:Folder}` |
| DELETE `/folders/:id` | empty folders only | `{ok:true}` |
| GET `/files` | `folderId`, `page`, `q` optional | `{files:AdminFile[],total,page,pageSize}` |
| PATCH `/files/:id` | `{name?,folderId?,keyIds?}` | `{file:AdminFile}` |
| DELETE `/files/:id` | retire metadata and remove R2 object | `{ok:true}` |
| POST `/uploads` | `{fileName,size,folderId?,keyIds,fingerprint}` | `{fileId,partSize,partCount}` |
| GET `/uploads/:id` | — | `{fileId,partSize,partCount,parts:[{partNumber,etag,size}]}` |
| PUT `/uploads/:id/parts/:number` | binary part body | `{partNumber,etag,size}` |
| POST `/uploads/:id/complete` | `{}` | `{file:AdminFile}` |
| DELETE `/uploads/:id` | abort incomplete upload | `{ok:true}` |
| GET `/users` | `q`, `page` optional | `{items:User[],total,page,pageSize}` |
| PATCH `/users/:id` | `{notes?,blocked?}` | `{user:User}` |
| GET `/downloads` | `userId`, `keyId`, `fileId`, `q`, `page` optional | `{items:Download[],total,page,pageSize}` |
| POST `/trace` | `{marker,fingerprint?}` | `{authentic:true,contentMatch,record,user,key,file,signedName}` |
| GET `/settings` | — | `{siteName,adminPath,ipRetentionDays}` |
| PATCH `/settings` | `{siteName?,adminPath?,ipRetentionDays?}` | updated settings |
| POST `/password` | `{currentPasswordKey,passwordKey,passwordSalt}` | `{ok:true}`; existing admin sessions invalidated |

- `Key`: `{id,code,name,enabled,createdAt}`. Imported secrets use 32-byte base64url.
- `Folder`: `{id,name,parentId,defaultKeyIds}`.
- `AdminFile`: `{id,name,originalName,folderId,size,fingerprint,keyIds,status,uploadedAt}`.
- `User`: `{id,userId,firstSeenAt,lastSeenAt,notes,blocked}`.
- `Download`: `{id,userId,userName,keyId,keyName,fileId,fileName,createdAt,ip,status}`;
  `userId` is the internal ID, `userName` is the external user-defined identifier.
- `contentMatch` is boolean when a fingerprint is provided, otherwise null. Invalid
  envelopes produce a descriptive error; unknown/deleted objects do not erase valid
  provenance. Never return raw secrets or full markers in ordinary list responses.
- Lists use page size 50, capped internally. `q` is a bounded literal search string.

## Marking package

Package name: `@inkparcel/marking`. Implementation lives in `packages/marking`.

```ts
export interface ByteRange { offset: number; length: number }
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
export const apkHandler: MarkerHandler;
export function blobSource(blob: Blob): ByteSource;
export function inspectApk(source: ByteSource): Promise<unknown>;
export function fingerprintApk(source: ByteSource,
  onProgress?: (bytes: number, total: number) => void): Promise<string>;
export function handlerFor(fileName: string): MarkerHandler;
```

Fingerprint output is lowercase 64-character SHA-256 hex. The APK implementation
must document its normalization and preserve original signing identity. The marker
is opaque UTF-8 authenticated-envelope text to this package. Worker/browser code
uses TextEncoder/TextDecoder only at envelope boundaries.

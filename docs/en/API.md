[简体中文](../API.md) | English

# HTTP and shared module contracts

This document fixes the v0.1 interface shared by the Worker and browser. JSON
success bodies are direct objects; errors are `{error:{code,message}}`. Mutating
requests require a same-origin `Origin` header, JSON except upload parts, and the
appropriate HttpOnly cookie. All timestamps are ISO 8601 UTC. IDs are opaque strings.

## Routing and authentication

`A` below is the configured admin path (for example `/control-random`); it must never
be compiled into frontend assets or returned by public discovery APIs.

| Method / path       | Request                                               | Response                                                                         |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET `/api/site`     | —                                                     | `{name, initialized, stealthMode, iconUrl}`                                      |
| GET `/api/setup`    | —                                                     | `{available:true}` only before setup, otherwise 404                              |
| POST `/api/setup`   | `{bootstrapToken,passwordKey,passwordSalt,adminPath}` | `{adminPath}` + admin cookie                                                     |
| GET `A/api/auth`    | —                                                     | `{authenticated,passwordSalt,kdf:{algorithm:"PBKDF2-SHA256",iterations:600000}}` |
| POST `A/api/login`  | `{passwordKey}`                                       | `{ok:true}` + admin cookie                                                       |
| POST `A/api/logout` | —                                                     | `{ok:true}` + cleared cookie                                                     |
| POST `/api/access`  | `{userId,code}`                                       | `{user:{id,userId},key:{id,name}}` + recipient cookie                            |
| GET `/api/session`  | —                                                     | same session object or 401                                                       |
| POST `/api/logout`  | —                                                     | `{ok:true}` + cleared recipient cookie                                           |

`passwordKey` and `passwordSalt` are unpadded base64url: 32 derived bytes and at
least 16 random salt bytes, respectively. The frontend derives the password key
using WebCrypto PBKDF2-SHA256 (600,000 iterations, 256 output bits).

Admin sessions last eight hours; recipient sessions last 24 hours. Revoked recipient
sessions return 401 with `error.code=access_revoked`. Production HTTP GET/HEAD requests
redirect to HTTPS; unsafe HTTP requests are rejected. Only explicit local mode on
a loopback hostname allows HTTP development.

## Recipient library

| Method / path                   | Request                               | Response                                          |
| ------------------------------- | ------------------------------------- | ------------------------------------------------- |
| GET `/api/files`                | `folderId` optional, `page` default 1 | `{files,folders,breadcrumbs,total,page,pageSize}` |
| POST `/api/files/:id/downloads` | `{}`                                  | `{id,url,fileName}`                               |
| GET / HEAD `/api/downloads/:id` | standard HTTP range headers           | personalized attachment stream                    |

Public file objects: `{id,name,size,uploadedAt}`. Folder objects:
`{id,name,parentId}`. Breadcrumbs contain ancestor folder objects. Only visible
files/folders are returned. Root is `folderId=null` (omit query parameter).

Downloads are bound to the recipient session's user AND key. Byte ranges refer to
the personalized bytes. Authentication/authorization is checked on every request.
`fileName` is the effective attachment name: a missing supported extension is
appended using the format registry. Display names remain unchanged in file lists.

## Administration

All following paths are prefixed with `A/api` and require admin authentication.

| Method / path                    | Request                                                | Response                                                                 |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| GET `/keys`                      | —                                                      | `{items:Key[]}`                                                          |
| POST `/keys`                     | `{name,secret?}`; omitted secret generates 32 bytes    | `{key:Key,secret}` (secret displayed once)                               |
| PATCH `/keys/:id`                | `{name?,enabled?}`                                     | `{key:Key}`                                                              |
| POST `/keys/:id/code`            | `{userId}`                                             | `{userId,code}`                                                          |
| GET `/folders`                   | —                                                      | `{items:Folder[]}`                                                       |
| POST `/folders`                  | `{name,parentId?,defaultKeyIds?}`                      | `{folder:Folder}`                                                        |
| PATCH `/folders/:id`             | `{name?,parentId?,defaultKeyIds?}`                     | `{folder:Folder}`                                                        |
| DELETE `/folders/:id`            | empty folders only                                     | `{ok:true}`                                                              |
| GET `/files`                     | `folderId`, `page`, `q` optional                       | `{files:AdminFile[],total,page,pageSize}`                                |
| PATCH `/files/:id`               | `{name?,folderId?,keyIds?}`                            | `{file:AdminFile}`                                                       |
| DELETE `/files/:id`              | retire metadata and remove R2 object                   | `{ok:true}`                                                              |
| POST `/uploads`                  | `{fileName,size,folderId?,keyIds,fingerprint}`         | `{fileId,partSize,partCount}`                                            |
| GET `/uploads/:id`               | —                                                      | `{fileId,partSize,partCount,parts:[{partNumber,etag,size}]}`             |
| PUT `/uploads/:id/parts/:number` | binary part body                                       | `{partNumber,etag,size}`                                                 |
| POST `/uploads/:id/complete`     | `{}`                                                   | `{file:AdminFile}`                                                       |
| DELETE `/uploads/:id`            | abort incomplete upload                                | `{ok:true}`                                                              |
| GET `/users`                     | `q`, `page` optional                                   | `{items:User[],total,page,pageSize}`                                     |
| PATCH `/users/:id`               | `{notes?,blocked?}`                                    | `{user:User}`                                                            |
| GET `/downloads`                 | `userId`, `keyId`, `fileId`, `q`, `page` optional      | `{items:Download[],total,page,pageSize}`                                 |
| POST `/trace`                    | `{marker,fingerprint?}`                                | `{authentic:true,contentMatch,record,user,key,file,signedName}`          |
| GET `/settings`                  | —                                                      | `{siteName,adminPath,ipRetentionDays,stealthMode,iconUrl,hasCustomIcon}` |
| PATCH `/settings`                | `{siteName?,adminPath?,ipRetentionDays?,stealthMode?}` | updated settings                                                         |
| POST `/password`                 | `{currentPasswordKey,passwordKey,passwordSalt}`        | `{ok:true}`; existing admin sessions invalidated                         |

- `Key`: `{id,code,name,enabled,createdAt}`. Imported secrets use 32-byte base64url.
- `Folder`: `{id,name,parentId,defaultKeyIds}`.
- `AdminFile`: `{id,name,originalName,folderId,size,fingerprint,keyIds,status,uploadedAt}`.
- `User`: `{id,userId,firstSeenAt,lastSeenAt,notes,blocked}`.
  Notes permit multiline text (CRLF becomes LF); other identity/name fields remain
  single-line. Unpaired UTF-16 surrogates and unsupported control characters reject.
- `Download`: `{id,userId,userName,keyId,keyName,fileId,fileName,createdAt,ip,status}`;
  `userId` is the internal ID, `userName` is the external user-defined identifier.
- `contentMatch` is boolean when a fingerprint is provided, otherwise null. Invalid
  envelopes produce a descriptive error; unknown/deleted objects do not erase valid
  provenance. Never return raw secrets or full markers in ordinary list responses.
- Lists use page size 50, capped internally. `q` is a bounded literal search string.
- The current installation supports 100 keys and 1000 folders. ACL updates use bulk
  SQL within a transaction, including when selecting all 100 keys.

### Deletion and management paths

`DELETE A/api/keys/:id` and `DELETE A/api/users/:id` require an admin session and
same-origin Origin, return `{ok:true}`, and are retryable. Soft-deleted identities
are omitted from normal lists. Key deletion permanently disables access and removes
file ACLs and folder defaults; user deletion permanently blocks the identity so old
codes cannot automatically register it again. Issuance records, identity mappings and
key material remain for tracing. PATCH cannot restore deleted identities. The
100-key limit counts only nondeleted keys; importing a deleted key's secret is still rejected.

Setup and settings accept a single adminPath segment of 1–64 ASCII letters, digits,
underscores or hyphens. Leading/trailing whitespace is trimmed and a leading slash is
added, for example `manage` becomes `/manage`. Hyphens are optional. Unicode names,
nested paths, query strings and fragments are unsupported. Case-insensitive reserved
names are `admin`, `api`, `assets`, `favicon`, `robots` and `downloads`.

## Marking package

Binary parsing, supported signatures and fingerprint normalization are defined in
[APK format](apk-format.md).

Package name: `@inkparcel/marking`. Implementation lives in `packages/marking`.

```ts
export interface ByteRange {
  offset: number;
  length: number;
}
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
export function fingerprintApk(
  source: ByteSource,
  onProgress?: (bytes: number, total: number) => void,
): Promise<string>;
export function handlerFor(fileName: string): MarkerHandler;
export interface FileFormat {
  id: string;
  version: string;
  extensions: readonly string[];
  mediaType: string;
  handler: MarkerHandler;
  fingerprint(
    source: ByteSource,
    onProgress?: (bytes: number, total: number) => void,
  ): Promise<string>;
  assertMarkable(source: ByteSource): Promise<void>;
}
export function formatFor(fileName: string): FileFormat;
export const supportedExtensions: readonly string[];
```

Fingerprint output is lowercase 64-character SHA-256 hex. The APK implementation
must document its normalization and preserve original signing identity. The marker
is opaque UTF-8 authenticated-envelope text to this package. Worker/browser code
uses TextEncoder/TextDecoder only at envelope boundaries.

The APK descriptor is `id="apk"`, `version="apk-v1"`, `extensions=[".apk"]`.
Its preflight guarantees space for any permitted marker before an upload becomes
ready. Stored format versions are checked during finalization, issuance and download;
a mismatched handler version returns 409 instead of changing an existing issuance's
bytes. Add a new format module and registry entry to supply marking/extraction,
fingerprinting, preflight and media metadata without format branches in the workflow.

`stealthMode` is a boolean setting, false by default, writable only through the authenticated settings endpoint. `/api/site` exposes it to select the public presentation. Omitting it from a settings PATCH preserves its value. It changes presentation only, not authentication, marking, downloads or tracing.

Site branding uses `siteName` everywhere in the rendered application and document
title. `iconUrl` is a same-origin public URL. `PUT A/api/site-icon` accepts raw
`image/png` bytes up to 256 KiB with dimensions 1–1024 pixels; it validates PNG
signature/header/end structure. The browser also checks image decodability.
`DELETE A/api/site-icon` restores the built-in icon. Both require administrator
authentication and same-origin Origin and return `{iconUrl,hasCustomIcon}`.
`GET/HEAD /api/site-icon` serves PNG or the built-in SVG with nosniff and no-store.
Replacement updates a versioned URL and the single D1 icon row atomically.

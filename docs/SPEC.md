# InkParcel specification

This is the authoritative v0.1 specification for a generic Cloudflare-hosted file
distribution service; implementation and acceptance status live in `validation.md`.

## Product and scope

An administrator distributes personal access codes, uploads APKs into folders and
selects which keys may access each file. Recipients authenticate with their chosen
user ID and code, browse their authorized files, and receive an APK with a signed
recipient marker. Administrators extract markers locally in the browser and verify
their issuance records without uploading the selected file.

The initial release includes setup, password login, configurable admin path, key
generation/import/disable, code generation, user blocking and notes, folders, APK
multipart upload, explicit multi-key file visibility, file management, resumable
personalized downloads, searchable issuance records, local trace verification,
deployment instructions, backup guidance, automated checks and generic APK fixtures.

Additional formats, runtime folder ACL inheritance, per-user code rotation, paid
billing features, multiple administrators and anti-removal watermarking are out of
scope. Interfaces must permit adding handlers without changing issuance logic.

## Platform and architecture

- React + TypeScript + Vite frontend; Hono Worker API; private R2 storage and D1.
- One deployment, same-origin APIs and cookies, static assets through the Worker
  routing policy. Unknown pages and retired admin paths return an actual HTTP 404.
- No entire APK buffers or whole-file hashing in Worker download requests. Sources
  support bounded random reads and streamed ranges. Browser hashing is incremental.
- Standard multipart uploads use 16 MiB parts (last may be smaller), streamed through
  authenticated Worker endpoints to R2. This avoids mandatory S3 API credentials and
  Cloudflare's 100 MB inbound request ceiling. Failed parts can be retried.
- Free-tier compatibility is a target to measure, not an unlimited-free promise.
  Remote CPU, account quotas and billing depend on the deployment. Never infer
  Workers Free 10 ms CPU acceptance from local runtime tests.

## Identities, secrets and authentication

- Normalize user IDs with trim + Unicode NFC, preserve case; limit to 128 characters
  and reject control characters. Use the identical function for issuing and login.
- Public UUIDs identify users; markers never contain raw external user IDs.
- Each key has immutable UUID/short code, editable display name, 256-bit secret,
  enabled state and creation time. Duplicate secret imports are rejected. Secrets
  are encrypted in D1 using purpose-separated material from `APP_SECRET`.
  The initial operational limits are 100 keys and 1000 folders; bulk ACL writes
  remain inside the D1 Free request query limit at those bounds.
- HMAC-SHA-256 codes have a public key ID prefix and at least 128 authentication bits.
  Code and marker subkeys are domain separated; comparison is constant-time.
- A recipient session binds one user and one successfully validated key. First
  successful validation creates the user; future keys reuse the user identity.
- Every list, issuance and download checks user status, key status, file status and
  explicit file-key ACL. Historical keys do not expand the active session's ACL.
- Disabled keys cannot authenticate or download, but still verify old markers.
  Individual users can be blocked. Stateless codes do not support per-user rotation.
- Admin setup requires `BOOTSTRAP_TOKEN` from deployment secrets. At `/admin`, a
  wizard collects a password and new nonreserved admin path, then atomically closes
  setup. Concurrent setup attempts cannot overwrite a completed installation.
- Password work factor must not be reduced to meet Worker CPU limits. The browser
  derives a 256-bit password key with PBKDF2-SHA-256, 600,000 iterations and a random
  per-password salt; the Worker stores a purpose-separated keyed verifier using
  `APP_SECRET`. The derived key is password-equivalent and only travels in a TLS
  POST body, never URLs or logs. The database alone cannot verify password guesses.
- Admin and recipient cookies are separate, HttpOnly, Secure in production and
  SameSite=Strict. Mutations enforce Origin/CSRF protection. Authentication is rate
  limited; password changes invalidate old admin sessions. Local HTTP development
  may omit Secure cookies only when explicitly configured as local.
- Backups must cover D1, R2 and deployment secrets. Losing marker secrets or recipient
  mappings makes historical trace verification impossible.

## Files, folders and uploads

- Folders form an acyclic parent tree. They organize files, not runtime permission
  inheritance. Renaming/moving folders or files never changes file ACLs.
- Each file row is an immutable uploaded version with random object key, original
  name snapshot, display name, folder, size, normalized content fingerprint,
  handler version, upload time and pending/ready/deleted state. Re-uploading a name
  creates a new version; historical objects/identities are never overwritten.
- Display names may omit an extension. Issuance appends the registered format's
  primary extension when needed and snapshots this effective download filename in
  both the marker and record, so the result remains installable and locally traceable.
- `file_keys` is explicit many-to-many authorization. Empty selection means admin
  only. Folder defaults may be copied at upload, never applied retroactively.
- Recipient folders are only the ancestors of accessible files; hidden filenames
  and empty unauthorized folders must not be exposed.
- Upload sessions bind authenticated administrators, object keys, expected sizes and
  part indexes. Finalization validates actual object length and APK structure before
  marking ready, including capacity for any permitted marker. Browser supplies the normalized fingerprint; the trust boundary is
  the authenticated uploader, and local tracing recomputes it independently.
- Incomplete uploads can be resumed/aborted; cleanup handles stale multipart state.
  File deletion is logical for provenance and removes the object when requested.
  Key deletion cannot destroy historical verification material.

## Marker and APK contracts

The byte-level format and fingerprint algorithm are defined in [APK format](apk-format.md).

- A versioned authenticated envelope binds key ID, opaque recipient ID, immutable
  file ID, normalized fingerprint, issued-name snapshot and unique issuance ID.
  Authenticate exact serialized bytes, bound sizes, and reject unsupported versions.
- A handler exposes `mark(source, marker)` and `extract(source)`. The source offers
  size, bounded reads and streams. Mark returns the output size and a range-capable
  stream factory so byte ranges refer to the personalized representation.
- The format registry also supplies media type, extensions, immutable format version,
  local fingerprinting and bounded preflight. Upload/download/trace workflows select
  these capabilities from the registry. Stored version mismatches fail explicitly;
  an upgrade must not silently change an existing issuance's bytes or fingerprint.
- Extension chooses a handler candidate; structural validation confirms the format.
  Unsupported formats and unsupported signing layouts fail explicitly.
- APK support preserves existing v2/v3-family signatures using a dedicated custom
  APK Signing Block ID. Preserve unknown entries and verity alignment/padding;
  reject ZIP64, malformed lengths, duplicate own markers and unsafe offsets.
- Initial uploads containing InkParcel markers are rejected. Marked output must
  preserve signing certificates and pass Android apksigner verification for the
  supported fixture matrix. v1-only inputs and existing v4 .idsig reuse are excluded.
- Browser fingerprinting uses the documented canonical APK representation independent
  of the mutable marker and padding. It distinguishes payload changes and binds
  signing identity. Both marked and source files have the same normalized fingerprint.
- A valid marker proves issuance, not culpability or tamper resistance. Marker
  removal/copying is possible. Trace results separately show envelope authenticity,
  file fingerprint match and issuance/user/version metadata. Never silently treat
  an authenticated marker alone as proof of whole-file identity.

## Downloads and records

- Create and persist an issuance and its exact marker before sending personalized
  bytes. Each issuance has stable output bytes, length and ETag across retries.
- Single byte ranges, suffix ranges, HEAD, If-Range and 416 behavior must be correct.
  Multi-range may be explicitly rejected. Resumed requests are one issuance.
- R2 originals stay private. No presigned original GETs. Personalized responses use
  private/no-store caching; access revocation is checked on resumed requests too.
- Records represent issuance/transfer initiation, not proof of local file save.
  The UI states this limitation. Record per-request transfer attempts only if useful;
  never inflate issuance counts for ranges or HEAD probes.
- Provenance mappings remain after file/key retirement. IP retention is separately
  configurable and can be cleared without destroying issuance metadata.

## User interface

- Responsive Chinese-first UI with consistent English project terminology. Public
  page: user ID/code login, folder breadcrumbs, authorized files, sizes and downloads.
- Admin: setup/login, file library (folders, uploads, multi-key ACL, rename/delete),
  keys/codes, users/notes/blocking, filtered issuance records, local trace, settings.
- Upload progress/retry/abort, meaningful empty/error/loading states, keyboard labels,
  confirm destructive actions and no plaintext secret exposure in tables.
- Trace file stays in the browser; show local processing progress and distinguish
  no marker, malformed marker, invalid authentication and mismatched content.

## Acceptance gates

1. Fresh setup, race protection, retired-path 404, login/logout and password/session
   invalidation work in the actual Worker runtime with D1 migrations and R2 binding.
2. Generated/imported keys and codes work; disabled users/keys and cross-key list,
   issuance and direct-download access are rejected; history remains verifiable.
3. Nested folders, explicit multi-key ACL, admin-only files, moves and folder defaults
   follow the documented rules; no inaccessible file metadata leaks.
4. Multipart upload/retry/abort/finalization work, malformed APKs cannot become ready,
   and same-name uploads retain independent identities.
5. Real generic signed APKs preserve apksigner verification and certificates after
   marking. Cover v2, v2+v3, v3.1 rotation and verity padding where tooling supports;
   unsupported cases must be rejected or explicitly scoped before release.
6. Extraction and normalized fingerprints round-trip; malformed/duplicate markers,
   truncation, ZIP64, >2 GiB offsets and bounded reads have meaningful regressions.
7. Stable full and range downloads, cross-segment ranges, HEAD/ETag/If-Range, rejected
   ranges, revocation and private caching are verified end to end.
8. Browser setup, public download and local trace are exercised through rendered UI;
   responsive layouts, errors and user-visible wording are visually inspected.
9. Typecheck, relevant tests, production build, deployment dry run and clean Git
   history pass. CI runs reproducible checks with a lockfile and generated fixtures.
10. Deployment, secrets, migrations, free-tier limits, supported APK cases, backup,
    upgrade and security reporting are documented. Remote-only checks are reported
    honestly and require a configured Cloudflare account; no paid resources created
    implicitly. Publishing happens only after a concrete reviewable release exists.

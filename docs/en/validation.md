[简体中文](../validation.md) | English

# Validation status

This page records v0.1 local and remote functional acceptance through 2026-10-09.
These results do not establish Cloudflare Free CPU acceptance.

## Local acceptance

- `pnpm check` passes formatting, relative documentation links/anchors, all TypeScript
  checks, 67 package tests and the Vite/Worker production build with deployment dry run.
  The package split is 29 binary, 22 Worker integration and 16 browser-logic tests.
- Worker integration uses actual local Workerd with D1 migrations and R2 bindings:
  protected/concurrent setup, old-path 404, HTTPS/Origin enforcement, password/session
  invalidation, cross-key isolation, user controls, folders, 100-key bulk ACL updates,
  multipart retries/abort/recovery, format capacity/version checks, range semantics,
  historical trace, Unicode validation, multiline notes and retention cleanup.
- `pnpm fixtures` generates independent generic APKs and disposable signing keys.
- `pnpm test:apk` preserves Android `apksigner` verification and signing certificates
  for v2, v1+v2, v2+v3, verity, v3.1 rotation and a 34 MiB stored-payload fixture.
  Extraction, normalized fingerprints and beginning/cross-block/end ranges pass for
  each. v1-only inputs are rejected. Local SDK build-tools: 37.0.0.
- `pnpm test:e2e` passes the Chromium workflow through the real local Worker: browser
  initialization, key creation/code issue, 34 MiB multipart upload with two visible
  keys, display-name edits without an extension, personalized download and signature
  verification, local trace, actual suffix-byte comparison, notes/record filtering,
  cross-key denial, disabled-key denial with historical verification, and resumed
  missing parts after clearing browser storage. The recovery loading gate, admin
  path migration, old-password rejection and new-password login are exercised too.
- Trace network requests contain only the marker and fingerprint (under 8 KiB),
  while the selected file is about 34 MiB. No file body is uploaded for tracing.
- Desktop and 390 px mobile pages were visually inspected. A mobile table overflow
  was fixed and checked separately: page width remains 390 px while the table can
  scroll internally. The E2E guard checks page width and disables screenshot animation.
- `pnpm setup:local` and `pnpm db:migrate` create fresh private local configuration
  and apply the initial schema. Production dependency audit reports no known advisories.
- Large-offset coverage uses sparse synthetic sources above 2 GiB; this is parser
  coverage, not evidence of a completed multi-gigabyte network transfer.

Local build tools run inside the `dev` Distrobox container. Signature fixtures and
test signing keys are generated under ignored `target/`; the generation and checking
scripts are committed, so the evidence can be reproduced without private inputs.

The identity-deletion and short-admin-path batch passed `pnpm check` and Chromium E2E.
Coverage includes unauthorized deletion, post-deletion login/range revocation, list
and ACL cleanup, rejected restoration, historical tracing, short-path normalization,
reserved paths and retired-path 404. Browser checks cover cancel/confirm deletion,
entering `manage` directly and tracing after identity deletion. Migration
`0002_identity_deletion.sql` was applied against real local D1.

The stealth/branding batch passed `pnpm check` (59 tests) and Chromium E2E.
It covers administrator-only mode changes, marking while stealth is enabled,
restored standard presentation, neutral mobile login/library pages, escaped HTML
titles, global site-name updates and PNG upload/size/type/dimension validation.
Icon retrieval preserves bytes; replacement uses a new URL and one database row;
reset returns the built-in icon. Browser checks confirm header/tab icon updates and
reset, with no fixed InkParcel branding after a custom site name is saved. The 390 px
minimal login and library screenshots were visually inspected.

On 2026-10-08, the icon/i18n batch passed 62 package tests, type checking, the
production build/dry run and Chromium workflows. Translation resources have equal
key and interpolation coverage. Browser checks cover English errors, language
persistence after reload, translated admin navigation/confirmations, unchanged
user data and form drafts across dialog language changes, and locale-aware HTML.
Custom icons replace the old wrapper with no background or rotation; clearing an
icon restores the original black emblem and empty settings state. Mobile layouts
and the English retrieval page were visually inspected.

The 2026-10-09 CDN change passes `pnpm check` (67 tests: 29 marking, 22 Worker and 16 frontend) and the full Chromium workflow. New coverage includes explicit origins, proxy Host rewriting, rejection of unknown origins and cross-site mutations, tampered/expired/mis-scoped download credentials, and rejection after user/key/file ACL/source revocation. Through a streaming local reverse proxy, Chromium verifies settings, cancellation without issuance, default direct selection, cross-origin download without CDN cookies, CDN-domain login, HEAD/suffix ranges and APK signatures. The 390 px mobile chooser and selection retention across language changes were visually checked. Migration `0005_download_sources.sql` was applied in real local D1.

## Continuous integration

The committed [Checks workflow](../../.github/workflows/checks.yml) runs the local
checks, generated Android signature matrix and Chromium workflow on Ubuntu/Node 24.
[Run 37622194426](https://github.com/ccc007ccc/inkparcel/actions/runs/37622194426)
passed for code commit `6bb3fa6`: all 55 package tests, production build/dry run,
six signed APK combinations plus the v1-only rejection, and the complete Chromium
workflow. This is historical CI evidence for that commit; later executable changes require
their own affected checks.

## Remote acceptance

On 2026-10-09, the direct origin and a Tencent Cloud EdgeOne CDN origin serving the same instance passed feature acceptance. D1 was backed up before applying `0005_download_sources.sql` and deploying. With two sources configured, a browser downloaded a generic approximately 34 MiB APK (35,659,995 bytes) through the CDN from the direct page, preserving its signature. One HEAD probe encountered a transport disconnect. A smaller generic v2 fixture then passed CDN-page login, cross-origin downloads in both directions, identical full retries, HEAD length, and repeated suffix 206/Content-Length/Content-Range checks. Responses retained private/no-store without cache HITs. Disabling the test key made range requests to the same CDN URL return 401 access_revoked. Test files, keys and users were retired/cleaned up while issuance mappings were preserved. This establishes functional behavior for that chain, not domestic-network speed measurements or verification of other EdgeOne rule configurations.

On 2026-10-07 a configured Cloudflare Worker, D1 and private R2 deployment passed
functional checks using a generic fixture, without private project files:

- Custom-domain HTTPS, administrator setup and login passed. After setup, `/admin`
  and `/api/setup` returned 404 and the remote bootstrap secret was removed. R2
  public access remained disabled.
- A roughly 34 MiB signed fixture passed three-part upload, recipient login, full
  download, APK signature verification and canonical fingerprint comparison.
- The first transfer exposed a missing Content-Length on ordinary ReadableStream
  range responses. Commit `1afc809` uses FixedLengthStream without buffering the
  artifact. Worker type checking and all 13 integration tests passed after the fix.
- The corrected remote GET/HEAD reported 35,659,995 bytes and the full GET received
  exactly that size. A suffix response returned 206 and Content-Length 64, matching
  the final 64 bytes of the complete output. Retries reused an identical issuance.
- Browser-local tracing sent only marker and fingerprint, under 8 KiB. Disabling
  the key rejected range access with 401 while historical trace verification passed.
- The test R2 file and empty folder were removed; the test key and identity were
  disabled, retaining issuance metadata.

These results cover functionality and this fixture transfer only. The actual
account plan and Workers Free 10 ms CPU compliance remain unconfirmed and require
measurement against a configured deployment and target APK sizes. Local Workerd,
signature verification and synthetic offsets cannot prove these properties. R2 subscriptions and over-quota charges remain operator-managed.

No physical Android installation/runtime acceptance, pure v3 APK support, reused v4
`.idsig`, anti-removal watermarking or externally modified app compatibility is
claimed. An application that verifies its complete APK bytes may reject a marked
copy even when Android signature verification succeeds. Validate representative
originals for the deployment before distributing them.

# Validation status

This page records v0.1 local acceptance on 2026-10-07 and the separate deployment
boundaries. It does not claim production deployment or Cloudflare Free CPU acceptance.

## Local acceptance

- `pnpm check` passes formatting, relative documentation links/anchors, all TypeScript
  checks, 55 package tests and the Vite/Worker production build with deployment dry run.
  The package split is 29 binary, 13 Worker integration and 13 browser-logic tests.
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

## Continuous integration

The committed [Checks workflow](../.github/workflows/checks.yml) runs the local
checks, generated Android signature matrix and Chromium workflow on Ubuntu/Node 24.
The first GitHub execution will be recorded after the repository is created.

## Remote acceptance

Cloudflare account deployment, real R2 transfer behavior, and Workers Free 10 ms
CPU compliance require measurement against a configured deployment and target APK
sizes. Local Workerd, signature verification and synthetic offsets cannot prove
these properties. R2 subscriptions and over-quota charges remain operator-managed.

No physical Android installation/runtime acceptance, pure v3 APK support, reused v4
`.idsig`, anti-removal watermarking or externally modified app compatibility is
claimed. An application that verifies its complete APK bytes may reject a marked
copy even when Android signature verification succeeds. Validate representative
originals for the deployment before distributing them.

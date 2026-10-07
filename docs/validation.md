# Validation status

This page records the current local v0.1 acceptance evidence and remaining release
gates. It does not claim a production deployment or Cloudflare Free CPU acceptance.

## Verified kernel

- `pnpm --filter @inkparcel/marking typecheck` and 25 binary regression tests pass.
- `pnpm fixtures` generates independent generic APKs and disposable signing keys.
- `pnpm test:apk` preserves Android `apksigner` verification and signing certificates
  for v2, v1+v2, v2+v3, verity, v3.1 rotation and a 34 MiB stored-payload fixture.
  Extraction, normalized fingerprints and beginning/cross-block/end ranges pass for
  each. v1-only inputs are rejected. Local SDK build-tools: 37.0.0.
- Large-offset coverage uses sparse synthetic sources above 2 GiB; this is parser
  coverage, not evidence of a completed multi-gigabyte network transfer.

## In progress

Worker authorization/storage integration, browser end-to-end acceptance, release
build/CI and deployment instructions are being completed against [SPEC](SPEC.md).
The implementation must pass these gates before being described as release-ready.

## Remote acceptance

Cloudflare account deployment, real R2 transfer behavior, and Workers Free 10 ms
CPU compliance require measurement against a configured deployment and target APK
sizes. Local Workerd, signature verification and synthetic offsets cannot prove
these properties. R2 subscriptions and over-quota charges remain operator-managed.

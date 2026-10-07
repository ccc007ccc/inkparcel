# InkParcel

**Self-hosted file delivery with verifiable recipient markers.**

Give each recipient a personal access code. Organize private files into folders,
choose which distribution keys can access them, and issue a personalized download.
When a copy resurfaces, extract its marker locally in your browser and look up the
associated recipient and file version. The selected file is never uploaded for tracing.

InkParcel runs on Cloudflare Workers, R2 and D1. Its first format handler supports
Android APKs using a custom APK Signing Block entry, without the publisher's signing
key or a re-signing step. The responsive administration interface is in Chinese.

![InkParcel recipient page](docs/assets/preview.png)

## What it includes

- Personal codes derived from a user-defined ID and named distribution key.
- Automatic recipient registration, notes, user blocking and key disabling.
- Nested folders and explicit multi-key file visibility; empty visibility is private
  to the administrator. Moving a file never changes its permissions.
- Resumable multipart uploads and private, streamed personalized downloads.
- Stable per-issuance bytes, HTTP byte ranges and immutable uploaded versions.
- Local marker extraction and incremental content-fingerprint verification.
- One-time protected setup, configurable admin path and password authentication.
- A shared format registry for marking, extraction, fingerprints and preflight checks.

An intact authenticated marker identifies an **issuance record**. It can be removed
or copied, and does not prove who leaked a file. See [security boundaries](SECURITY.md)
and the [supported APK layouts](docs/apk-format.md).

## Try it locally

Requires Node.js 22.12 or newer and pnpm 9.15.9. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate
pnpm dev
```

Open the local URL printed by Wrangler and visit `/admin`. Use the generated
`BOOTSTRAP_TOKEN` in `.dev.vars`, choose a strong password and save your new admin
path. The old `/admin` route is then retired. Local credentials and storage are
ignored by Git and are separate from Cloudflare resources.

On an immutable SteamOS workstation, run development commands inside
`distrobox enter dev`. Other development hosts can run them directly.

## Deploy your instance

Follow the [deployment guide](docs/deployment.md) to create a private R2 bucket and
D1 database, configure secrets, apply migrations and deploy a single Worker.

Small deployments can operate within Cloudflare's included allowances. This is
not an unlimited-free guarantee: R2 requires an active subscription, excess usage
may be billed, and Workers Free has a 10 ms CPU budget per invocation. Representative
remote file transfers must be measured before claiming suitability for that plan.

## Documentation and development

| Document                         | Purpose                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| [SPEC](docs/SPEC.md)             | Product behavior, scope and acceptance gates                   |
| [API](docs/API.md)               | HTTP and shared module contracts                               |
| [APK format](docs/apk-format.md) | Binary layout, supported signatures and canonical fingerprints |
| [Deployment](docs/deployment.md) | Local setup, Cloudflare deployment and cost boundaries         |
| [Operations](docs/operations.md) | Administration, backups, recovery and upgrades                 |
| [Validation](docs/validation.md) | Actual test evidence and unverified deployment boundaries      |
| [Contributing](CONTRIBUTING.md)  | Development and change-validation workflow                     |

`pnpm check` runs formatting, type checks, package tests and a production deployment
dry run. `pnpm fixtures && pnpm test:apk` generates generic APKs and verifies signature
preservation using the Android SDK. `pnpm test:e2e` exercises the real local Worker
through Chromium; see [Contributing](CONTRIBUTING.md) for prerequisites.

## License

[Apache-2.0](LICENSE). See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

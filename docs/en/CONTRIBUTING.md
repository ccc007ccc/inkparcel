[简体中文](../../CONTRIBUTING.md) | English

# Contributing to InkParcel

InkParcel welcomes fixes and focused file-handler additions. Read
[SPEC](SPEC.md) and [API](API.md) before changing a contract.

Use Node.js 22.12 or newer and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate
pnpm dev
```

On an immutable SteamOS workstation, run these commands inside the `dev` Distrobox
container. Other supported development hosts can run them directly.

Before submitting a change, run `pnpm typecheck`, the affected package tests and
`pnpm build`. Changes to binary marking additionally need the real signature checks:

```sh
# Requires Java, Python 3, Android SDK build-tools and a platform; set ANDROID_HOME.
pnpm fixtures
pnpm test:apk
```

Browser regression tests use isolated local D1/R2 state under `target/`:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Keep pull requests focused, describe the user-visible result and include validation
evidence. Do not include real APKs, distribution credentials, recipient information
or third-party signing keys. Generated test keys and binary fixtures stay ignored.

For security issues, follow [SECURITY.md](SECURITY.md), rather than opening a public
issue containing exploit details. Contributions are provided under Apache-2.0.

## Localization

UI resources live in `apps/web/src/locales/{zh-CN,en}.json`, using readable Chinese
source-message keys with i18next key separators disabled. Update both resources and
preserve interpolation names. Render messages with `t`, never translate user data,
and use full interpolated sentences when word order may differ. Preserve raw API
errors for diagnostics and translate stable codes for display. Tests check resource
coverage, interpolation, locale formatting and browser switching without form loss.

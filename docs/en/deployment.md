[简体中文](../deployment.md) | English

# Deployment

This guide deploys the current single-administrator InkParcel service; local checks
and remaining remote acceptance limits are recorded in [validation](validation.md).

## Local setup

Use Node.js 22.12 or newer and the repository-pinned pnpm 9.15.9. Run commands from
the repository root. On an immutable Linux host, enter a development container
first, for example `distrobox enter dev`; do not install dependencies on the host.

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate
pnpm dev
```

`setup:local` creates an ignored, owner-readable `.dev.vars` containing independent
local secrets. It preserves an existing file. Open Wrangler's printed localhost
URL, visit `/admin`, and use the local `BOOTSTRAP_TOKEN` to choose a password and a
new management path. Save that path in a password manager; `/admin` then returns 404.

The local D1 database and R2 objects live under ignored `.wrangler/` state. They
are separate from Cloudflare resources. Keep the development server on loopback:
only `ENVIRONMENT=local` together with a loopback hostname permits HTTP cookies.
Other deployments require HTTPS.

`pnpm dev` builds the client, watches it for changes and starts Wrangler. The
application is served by Wrangler, so its routing and same-origin security rules
also apply locally. `pnpm check` runs type checks, package tests and a deployment
dry run; it does not deploy the service.

## Cloudflare resources

Use a Cloudflare account with Workers, D1 and R2 available. Enabling R2 may require
an account billing setup. Review the account's plan and charges before creating
resources; the included allowances below are not a spending cap.

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create inkparcel
pnpm exec wrangler r2 bucket create inkparcel-files
```

Edit [wrangler.jsonc](../../wrangler.jsonc):

- Replace the placeholder D1 `database_id` with the ID returned by creation.
- Match `database_name` and `bucket_name` to the resources you created. Keep the
  application binding names `DB`, `BUCKET` and `ASSETS` unchanged.
- Keep `ENVIRONMENT` set to `production` and `run_worker_first` set to `true`.
  Worker routing is what enforces real 404 responses at unknown/retired paths.
- Keep the R2 bucket private: do not enable an `r2.dev` public endpoint or attach
  a public bucket domain. A custom domain belongs on the Worker, not the bucket.
- Use R2 Standard storage. The application does not need S3 API credentials,
  bucket CORS rules or a public original-file download endpoint.

The default Worker name is `inkparcel`. Change it if deploying a separate instance.
Use separate databases, buckets and secrets for separate instances. Keep personal
deployment settings outside Git. When using a separate configuration file, pass
`--config <config-path>` to subsequent Wrangler commands.

## First production deployment

Generate two independent secrets, each containing 32 random bytes encoded as
unpadded base64url. This command generates one; run it separately for each secret
and save both values in a password manager:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

`APP_SECRET` encrypts distribution keys and authenticates administrative verifiers
and sessions. `BOOTSTRAP_TOKEN` authorizes the one-time installation. Never reuse
the demonstration/test secrets or commit either production value. Local `.dev.vars`
is not a production secret deployment mechanism.

```sh
pnpm exec wrangler d1 migrations apply inkparcel --remote
pnpm check
pnpm run deploy
pnpm exec wrangler secret put APP_SECRET
pnpm exec wrangler secret put BOOTSTRAP_TOKEN
```

Paste each value at its named secret prompt. The initial deployment cannot complete
setup until both secrets are configured. Use `pnpm run deploy`, since `pnpm deploy`
is also a separate pnpm built-in command.

Open the deployed HTTPS Worker URL at `/admin`. Complete the wizard using the
production bootstrap token, choose a strong unique password and save the new
management URL. The password key is derived in the browser; first login/setup can
take a moment on slower devices. Reloading `/admin` and `/api/setup` should now give
404, and the new management URL should require normal authentication.

The bootstrap token can be removed after setup with
`pnpm exec wrangler secret delete BOOTSTRAP_TOKEN`; the installation remains closed
by database state. Do not remove or replace `APP_SECRET`.

The management path may be `manage` or `/manage`: one segment of 1–64 ASCII
letters, digits, underscores or hyphens, without a mandatory hyphen. Nested paths and
reserved names such as admin, api and assets are rejected. Inputs show these rules.
Save the complete returned management address after a change.

## Custom domain

The domain's zone must be active in the same Cloudflare account. Add a Worker
custom-domain route to the deployment configuration, for example:

```json
"routes": [{ "pattern": "files.example.com", "custom_domain": true }]
```

Deploy again. Wrangler/Cloudflare configures routing and the certificate. Once HTTPS
works, use this domain for administration and recipient access. Do not attach it to
R2 or commit a personal deployment domain to the open-source configuration.

## CDN and multiple download domains

For an existing instance, back up D1, apply migrations including `0005_download_sources.sql`, then deploy the checked build. Sign in through the direct origin and open **Site settings → Download sources and trusted domains**. Add, for example, “Direct” `https://files.example.com` and “CDN” `https://cdn.example.com`. Both must be domains you manage, serving the same Worker instance. The browser's current origin remains available; multiple origins enable the download chooser. Clearing sources restores the default single-origin behavior. To show only source names, turn off “Show download source domains” in this section and save. This display option requires migration `0006_download_source_display.sql`.

For reverse proxy CDNs such as Tencent Cloud EdgeOne:

1. Set the acceleration domain to `cdn.example.com` and point its DNS CNAME at the provider's assigned endpoint. Configure `https://cdn.example.com` as the download source. The assigned CNAME target is neither the public download domain nor the origin server.
2. Use the existing direct Worker domain `files.example.com` as the HTTPS upstream, with matching origin Host and TLS SNI. Never point upstream at the CDN itself or private R2 storage.
3. Prefer caching only content-hashed `/assets/*` files. Bypass all other paths, particularly `/api/*`, the admin page and its APIs. Never override `private, no-store`, ignore query parameters in cache keys or cache personalized files. CDN routing may improve speed; measure actual gains.
4. Forward full query strings and Origin, Sec-Fetch-Site, Cookie, Range and If-Range request headers. Preserve Set-Cookie, Content-Disposition, Content-Length, Content-Range and ETag responses. Disable APK body rewriting/automatic compression. Allow POST/PATCH/PUT/DELETE and avoid redirecting APIs across origins.
5. With valid CDN TLS, sign in and browse through its domain, then choose it for a download from the direct domain. Check HEAD, 206 resume, actual lengths and rejection after revocation. Purge old page/API caches after changing rules.

Login cookies are separate per domain. Cross-origin download links authorize only that issuance for one hour, without another login at the download domain. Choose a source again after expiry. Redact the token query parameter from CDN access logs. A broken source can be removed through the direct domain to restore default downloads.

For “Invalid request origin”, check that the complete HTTPS origin is saved as a source and that the CDN preserves browser Origin/Fetch Metadata headers. Keep origin validation enabled. See the [API contract](API.md#sources-and-cross-origin-downloads) for configuration and credential boundaries.

## Verify the deployed instance

Create a test key, upload an original supported APK, explicitly select its visible
keys and issue a code for a disposable recipient ID. In a separate browser session,
download the file, try a resumed download, then extract it using the local trace
page. Check the signing certificate and APK signature after download, and verify the
actual Content-Length of full and range responses. Verify that
disabling the key blocks further access while its prior marker remains verifiable.

Measure requests, CPU time, D1 usage and R2 operations with representative file sizes
before claiming Free-plan suitability. In particular, local tests do not establish
the remote 10 ms CPU limit. These instructions describe what an operator must do;
actual acceptance evidence belongs in the validation record.

## Free-tier boundaries

The following published allowances were checked on 2026-10-07. Confirm the current
official pages and the actual account plan before deployment.

| Service                                                                     | Included allowance relevant to this deployment                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) | 100,000 requests/day; 10 ms CPU per invocation                                                             |
| [R2 Standard](https://developers.cloudflare.com/r2/pricing/)                | 10 GB-month storage/month; 1 million Class A and 10 million Class B operations/month; free Internet egress |
| [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/)           | 5 million rows read/day; 100,000 rows written/day; 5 GB total account storage                              |

The D1 [per-database Free limit](https://developers.cloudflare.com/d1/platform/limits/)
is 500 MB; this application uses one database. Rows scanned and index writes count
toward usage, including authentication/rate-limit and maintenance queries.

An upload uses multiple Class A operations; a marked or resumed download uses
multiple Class B operations, plus Worker and D1 requests. Multipart parts are
16 MiB, and each retry is another operation. The strict routing policy invokes the
Worker before serving static assets, so do not assume the application's page and
asset requests bypass its request allowance. R2's free egress does not make storage,
requests or other connected services unlimited or unmetered. The project does not
automatically upgrade plans or enforce an account-wide billing ceiling.

For supported APK layouts and format boundaries, see [APK format](apk-format.md).
For backups, upgrades and ongoing administration, see [operations](operations.md).

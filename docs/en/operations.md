[简体中文](../operations.md) | English

# Operations

This guide covers current InkParcel administration, recovery and maintenance;
the authorization and marker contracts remain in [SPEC](SPEC.md).

## Keys, recipients and files

The initial service supports one administrator, up to 100 distribution keys and
1000 folders. Give keys meaningful names; their IDs and code prefixes are immutable.
Imported secrets must be 32-byte unpadded base64url and duplicates are rejected.
The secret is shown only when creating/importing a key. Keep any required export
in your secret manager; normal key listings do not reveal it.

Choose a recipient ID convention and use it consistently. IDs are trimmed and
normalized to Unicode NFC but remain case-sensitive. The same normalized ID shares
one user record across keys, while each login uses only its authenticated key's
file permissions. Auto-registration occurs after successful code verification.

Folder defaults only preselect keys for new uploads. File permissions are explicit;
moving files or changing defaults does not change existing permissions. An empty
file key selection means administrator-only. A same-name upload is a new immutable
version, not replacement of the earlier object. Supported layouts and binary size
boundaries are documented in [APK format](apk-format.md).

Disable a key to stop new authentication and later download requests, including
range retries. Block a user to stop that identity across keys. Bytes already sent
cannot be recalled, and a transfer already authorized may finish. Historical
encrypted key material remains available for trace verification. Re-enabling a key
restores its codes and existing sessions until those sessions expire. Per-user code
rotation, expiry and download-count limits are not implemented in this release.

File deletion retires metadata and removes its R2 object. Issuance records, signed
names and version identities remain for tracing. Download records mean issuance
or transfer initiation, not confirmation that a browser saved the whole file.
Keep the original APK and the applicable backup if you need to restore downloads.

User and key lists provide deletion buttons with impact confirmation. Deletion removes
an identity from management and permanently disables access; it is not erasure of
personal data or provenance. Historical records remain and editing cannot restore the
identity. Key deletion clears file permissions and folder defaults. A deleted user ID
cannot auto-register with an old code. Use blocking/disabling if access may need restoring.

## Public-page presentation

Enable **隐匿模式** in site settings and save to show a minimal retrieval page without
marker explanations or project promotion. Refresh the public page to load the setting.
Disable it to restore the standard presentation. It is off by default. User ID and
code are still required; downloads continue to receive markers and remain traceable
in administration. Use a neutral custom site name if desired. This is a presentation
option, not a guarantee that the marker or software cannot be identified.
Apply `0003_stealth_mode.sql` before deploying this version.

## Site name and icon

Saving the site name updates public and administrative branding, footers and page
titles; the current admin page refreshes its branding immediately. In site settings,
upload a PNG icon (up to 256 KiB, at most 1024×1024 pixels; square recommended).
Uploading applies immediately, separately from saving the settings form. The same
icon appears in headers and browser tabs; Clear removes the uploaded image and restores the original black emblem. A custom image replaces the emblem entirely, with no wrapper background or border. Other
open pages pick up changes on reload. Icons are included in D1 backups. Apply
`0004_site_icon.sql` before deploying this functionality.

## Interface language

Use the language selector to switch between Simplified Chinese and English. Chinese
is the default; each browser remembers its selection. Dialogs include a selector too,
so unfinished forms can be retained. Site names, user IDs, file names and key names
remain exactly as configured. Language does not change permissions or APK markers.

## Administrator access

Change the password through Settings while authenticated. Enter the current
password, generate the new password key in the browser and sign in again afterward:
all existing administrator sessions are invalidated. Administrator cookies expire
after eight hours; recipient cookies after 24 hours. Logout clears the browser's
cookie. Password changes, user blocking and key disabling provide the documented
server-side invalidation controls; individual session revocation is not available.

Changing the management path immediately retires its former page and API paths.
Save the returned path. If the path is lost, an operator with D1 access can recover
it without resetting the installation:

```sh
pnpm exec wrangler d1 execute inkparcel --remote --command "SELECT admin_path FROM settings WHERE id = 1"
```

The path is an additional access obstacle, not a password replacement. A forgotten
administrator password has no email-based reset flow. Use a trusted recovery backup
and an explicit recovery procedure; do not delete the settings row or reopen public
setup to recover access. Routine password changes do not require editing SQL.

## Backup and restore

A usable backup includes all of these:

- The D1 database, including distribution-key ciphertext, recipient mappings,
  file/version metadata, issuance markers and migration state.
- Every R2 original that must remain downloadable, preserving its object key.
- The exact corresponding `APP_SECRET`, the deployed release and binding
  configuration. Keep deployment secrets in an encrypted secret store separately
  from the database export. Retain the bootstrap token only if setup is unfinished.

Create a private backup directory outside the repository. For example, after setting
`INKPARCEL_BACKUP_DIR` to that directory:

```sh
pnpm exec wrangler d1 export inkparcel --remote --output "$INKPARCEL_BACKUP_DIR/database.sql"
```

Use an authenticated R2/S3 backup tool or the Cloudflare dashboard to copy objects;
no public bucket access is needed. An S3 credential used by that external backup tool
is an operational credential, not a required application secret. Include object
keys, sizes and checksums in the backup inventory. Keep the backup out of Git and
verify it by restoring into a separate private instance.

For a consistent snapshot, arrange a maintenance window with no writes or active
uploads. The application has no built-in maintenance switch. Stop or restrict
traffic at the deployment layer and account for scheduled maintenance as well.
Do not assume an independently timed D1 export and bucket copy form one atomic
snapshot.

Restore to fresh private D1/R2 resources using the saved release and binding
configuration. Import the database export, restore the original object keys, and
set the saved `APP_SECRET` before accepting traffic. Apply only migrations newer
than the restored schema. Validate administrative login, one original download,
and a historical marker before switching the production route. An exported SQL
snapshot can be imported into an empty destination database with:

```sh
pnpm exec wrangler d1 execute inkparcel --remote --file "$INKPARCEL_BACKUP_DIR/database.sql"
```

Point Wrangler at the destination database first. Do not import a snapshot on top
of an active installation. D1 Time Travel can assist database recovery, but it does
not back up R2 objects or Worker secrets.

Do not regenerate `APP_SECRET` during a reinstall or routine upgrade. Replacing it
invalidates sessions/password verification and prevents decryption of existing
distribution keys, breaking historical verification. Safe root-secret rotation
requires a ciphertext/verifier migration and is not a built-in feature. Losing
recipient mappings or issuance rows also removes required trace evidence; deleting
an R2 original alone does not erase its already-persisted issuance mapping.

## Retention and interrupted uploads

Settings defaults IP retention to 30 days and accepts 0–3650 days. Setting it to zero
clears stored IPs immediately and stops storing new ones. Other retention changes
take effect at the next scheduled cleanup. Marker and issuance mappings are kept;
IP cleanup does not delete provenance. Do not manually purge `downloads` as if it
were a disposable web access log.

The configured daily cron is `17 3 * * *`, at 03:17 UTC. It removes expired IPs,
old rate-limit buckets and expired part locks, then processes a bounded number of
uploads idle for at least 24 hours and retries pending object deletion. A backlog
may take multiple runs; monitor it rather than assuming all stale objects disappear
at the first deadline. Transient R2 cleanup failures remain retryable.

Pending multipart uploads can be resumed or aborted by an authenticated
administrator after signing in again. Retry failed parts; completed parts retain
their ETags. A failed completion request should be retried before sending the whole
file again, since R2 may already have completed it. A structurally invalid APK must
be aborted and replaced with a supported original. Uploads idle beyond the cleanup
window may be removed. Keep R2 multipart lifecycle policy consistent with the
intended resume window, and inspect orphaned multipart state after interrupted
database creation/restoration.

## Upgrades and diagnostics

Read release notes and make a tested backup before upgrading. Install the lockfile,
run local checks, apply the release's remote migrations and deploy the matching
Worker/assets together. Migration rollback is not automatic; restore a consistent
backup or use a release-specific recovery plan if schema rollback is required.

Monitor Worker CPU/errors and D1/R2 usage in Cloudflare. Review the current
[deployment allowances](deployment.md#free-tier-boundaries) before changing plans.
Avoid logging passwords, derived password keys, codes, marker payloads or real
recipient identifiers in issue reports. The default deployment disables request
observability, and application failures log an error class rather than body data.
Reproduce problems using generic fixtures where possible. Preserve the release,
request outcome and nonsecret resource state needed to distinguish an unsupported
APK, an authorization rejection and an infrastructure failure.

Identity deletion requires applying `0002_identity_deletion.sql` before deploying the
matching Worker and frontend. The migration only adds defaulted deletion flags and
indexes; it does not delete existing users, keys or records.

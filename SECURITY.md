# Security policy

The current 0.1 release line is the initial support target. Deployments should use
the latest patched release and retain backups of storage, database and secrets.

## Reporting

Use the repository's **Security → Report a vulnerability** private reporting form
when it is enabled. If that form is unavailable, contact the maintainer through
their GitHub profile and request a private reporting channel. Do not include
secrets, private files or exploit details in public issues.

## Security boundaries

- Recipient markers identify issuance records, not culpability. They can be removed
  or copied; InkParcel is not DRM or an anti-removal watermarking system.
- APK signature preservation is distinct from marker authentication. Only tested
  signing layouts are supported. APK v4 `.idsig` files cannot be reused after edits.
- The browser parses trace files locally. Fingerprints are computed on the operator's
  device. The server cannot independently inspect a file that was never uploaded.
- An administrator and their browser are trusted to upload files and fingerprints.
  An administrator, compromised application secret or compromised browser can defeat
  attribution. Do not treat this service as independent forensic evidence.
- A recipient's ID and access code may be shared. Block the user or disable the
  distribution key to revoke access; deterministic individual code rotation is not
  part of v0.1.
- The admin path reduces casual discovery but is not an authentication mechanism.
  Keep a strong password and protect the one-time bootstrap token.
- The browser's password-derived key is password-equivalent. It must only be sent
  over HTTPS. The Worker uses a secret pepper to verify it; exposing both the D1
  backup and APP_SECRET removes that additional protection.
- Public R2 access must remain disabled. Recipient downloads must pass through the
  Worker so authorization and personalized marking cannot be bypassed.

Never share `.dev.vars`, deployment tokens, D1 exports or unredacted recipient logs
when reporting a bug. See the deployment guide for backup and secret handling.

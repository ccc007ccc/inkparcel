[简体中文](../../AGENTS.md) | English

# InkParcel contributor instructions

InkParcel is a general-purpose self-hosted file distribution service. Keep examples,
fixtures, documentation, and commit messages independent of private deployments.

- Read `docs/SPEC.md` for behavior and `docs/API.md` for shared API contracts.
- On this workstation, builds, dependency installs, generators and tests run in
  `distrobox enter dev -- ...`; never install tools on the immutable host.
- Use TypeScript, explicit runtime validation, and small modules. Preserve unknown
  APK signing-block entries. Never buffer an entire artifact in the Worker.
- File authorization is explicit and belongs to the authenticated key. Check it
  again on download. Private R2 originals must never be publicly downloadable.
- Never commit credentials, real recipient data, uploaded artifacts, or private
  signing material. Test signing keys must be generated in ignored temporary paths.
- Add meaningful tests for authorization, binary parsing, cryptography and streaming
  changes. Run the affected checks after a coherent batch, then stop if they pass.
- Keep SPEC and API documents current when behavior changes. Put usage in guides,
  implementation contracts in SPEC/API, and evidence in `docs/validation.md`.
- Make coherent Git commits as work becomes verified. Do not publish or deploy
  unreviewed secrets or imply remote validation from local tests.

- Default documentation is Simplified Chinese; maintain English versions in `docs/en/` with language links when updating documentation.

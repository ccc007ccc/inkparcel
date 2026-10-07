[简体中文](../apk-format.md) | English

# APK marker format

This document defines the `@inkparcel/marking` v0.1 binary contract; tested signing
combinations and deployment acceptance belong in [validation](validation.md).

## Supported layout

The handler accepts a single-disk ZIP32 APK with an existing v2 signing entry
(`0x7109871a`). Additional v3 (`0xf05368c0`) and v3.1 (`0x1b93ad61`) entries are
preserved byte for byte. A v3-only file, v1-only file, split ZIP or ZIP64 file is
rejected. The file size may exceed 2 GiB but must not exceed 4 GiB minus one byte;
rewritten directory offsets must also fit the supported ZIP32 range.

`inspectApk` checks the EOCD ending/comment, disk and directory fields, directory
position and header, signing-block magic and matching sizes, and every entry
boundary. It requires a v2 entry. This is bounded structural inspection, **not**
cryptographic APK signature verification, decompression, or validation of every ZIP
entry and inner signature record. The administrator supplying an original is the
upload trust boundary. A recognizable signature ID alone does not establish that
its signature is valid. Release fixtures independently use Android `apksigner` to
verify originals and personalized outputs.

Every parser read requests at most 64 KiB. The complete signing block is limited to
16 MiB and 4096 entries. Markers are 1 byte through 16 KiB. These are application
limits to keep memory and parsing bounded, rather than Android format limits.
Lengths are decoded as unsigned little-endian integers, with 64-bit fields checked
before conversion to JavaScript numbers.

Publication also calls `assertApkMarkable`: it parses once, rejects an existing
InkParcel marker, and checks that **every** marker size from 1 byte through 16 KiB
fits the entry, block-size and output-offset limits. This does not stream the
payload or allocate hypothetical marked outputs. It checks the maximum length and
one byte less because an exactly page-aligned block needs no padding, while a
shorter marker can require another page and another entry. A structurally valid
original may fail this capacity check, for example at 4096 entries or near 4 GiB.

## Marking

InkParcel uses the dedicated outer APK Signing Block entry ID `0x49504b31` (`IPK1`)
and stores the opaque authenticated envelope as its value. This is a project ID,
not an Android-assigned signature scheme. Authentication and user mappings belong
to the application; the binary package has no access to secrets or recipient IDs.

The transformation preserves the bytes before the signing block, all existing
non-padding entries in their original order, and the Central Directory. It appends
one InkParcel entry, rebuilds outer block sizes, and updates the EOCD Central
Directory offset. Unknown duplicate IDs remain separate entries. Duplicate known
signature IDs, InkParcel entries, or verity padding entries are rejected to avoid
ambiguous interpretation. Marking an already marked original is also rejected.

The verity padding entry (`0x42726577`) is regenerated with zero bytes. Existing
4096-byte-aligned block capacity is reused when sufficient. Otherwise the new block
grows to an aligned size, with at least 12 bytes for a padding entry when present.
The signing block's starting offset never moves. This preserves the alignment
requirements of APK verity for originals that already satisfy those requirements.
The handler does not repair an originally invalid signature or alignment.

APK v2/v3-family signatures exclude mutable outer signing-block entries from their
content digest and normalize the EOCD offset. Android ignores unknown outer IDs,
which permits this transformation without the publisher's APK signing private key.
The separate v4 `.idsig` covers all APK bytes and is invalidated by personalization;
InkParcel distributes ordinary APK downloads, not reused `.idsig` files or
incremental-install packages.

## Canonical fingerprint version 1

The fingerprint is lowercase hexadecimal SHA-256 of the following canonical APK:

1. Preserve every byte before the APK Signing Block.
2. Remove the InkParcel entry and verity padding entry from the signing block.
3. Preserve all remaining entry bytes and ordering, including complete v2/v3-family
   signature and certificate data and all unknown entries.
4. Recalculate both outer signing-block size fields and retain the standard magic.
5. Preserve the Central Directory verbatim.
6. Preserve the EOCD and its comment, changing only the Central Directory offset to
   point immediately after the canonical signing block.

The canonical representation is for hashing and is not an installable output
contract: it deliberately omits verity padding. Original and marked APKs have the
same fingerprint. Changing a recipient marker or padding does not change it;
changing payload, retained metadata or signing identity does. This is not a ZIP
content-only hash and does not promise equality after rebuilding or resigning an
otherwise equivalent application. Future normalization changes require a new
handler/fingerprint version, not a silent reinterpretation of stored fingerprints.

`fingerprintApk` hashes this virtual file incrementally with `@noble/hashes`. Its
optional progress callback reports canonical bytes processed and canonical total
size. The browser computes it during upload and tracing. Large-file fingerprinting
must not run in a Worker request.

## Streams and tracing

`ByteSource` describes immutable bytes with exact-length bounded reads and range
streams. `blobSource` implements it using browser `Blob.slice`. The Worker supplies
an R2 adapter bound to an immutable object. `mark` returns a stable virtual file:
unchanged source ranges interleaved with replacement byte segments. It does not
store or buffer an entire personalized artifact.

`MarkedFile.stream({offset,length})` uses offsets in the **personalized** file,
including ranges crossing replacement boundaries. Calls for the same source and
marker produce the same bytes and length. Invalid ranges reject; source truncation,
excess streamed bytes and read failures propagate. Cancellation reaches the active
source stream. HTTP range parsing, authorization, HEAD, ETag and issuance lifetime
are responsibilities of the Worker layer.

The browser's `extract` reads only bounded tail/signing-block data and returns a
copied opaque marker or `null`. It does not upload the file. Local fingerprinting
requires reading all canonical bytes, but never buffers the complete file. The
application separately displays marker authenticity, content fingerprint match and
issuance metadata. A valid marker establishes an issuance record; it can be removed
or copied and does not prove who leaked a file. See [the product contract](SPEC.md#marker-and-apk-contracts).

## Format registration

`formatFor(filename)` returns the registered `id`, `version`, `extensions`,
`mediaType`, `handler`, `fingerprint` and `assertMarkable` capabilities.
`supportedExtensions` contains the leading-dot extensions for browser file
pickers. `handlerFor` remains a compatibility shorthand for `.handler`.
The APK descriptor is `id: apk`, `version: apk-v1` and `.apk`; version identifies
the persisted marking/fingerprint contract. `mark` and `extract` remain the two
functions on the marker handler. Preflight and fingerprinting are capabilities
of the surrounding format adapter, not part of envelope generation.

New formats provide an adapter and add one registry entry in
`packages/marking/src/registry.ts`. Uploads, downloads and browser tracing consume
the descriptor rather than branching on APK names or hardcoding a media type.

## References

- [Android v2 format and integrity-protected contents](https://source.android.com/docs/security/features/apksigning/v2)
- [Android v3 format](https://source.android.com/docs/security/features/apksigning/v3)
- [Android v3.1 signing blocks](https://source.android.com/docs/security/features/apksigning/v3-1)
- [Android v4 and `.idsig`](https://source.android.com/docs/security/features/apksigning/v4)
- [AOSP signing-block and ZIP64 checks](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/util/apk/ApkSigningBlockUtils.java)
- [AOSP apksig verity padding](https://android.googlesource.com/platform/tools/apksig/+/master/src/main/java/com/android/apksig/internal/apk/ApkSigningBlockUtils.java)

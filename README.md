# InkParcel

Self-hosted file delivery with verifiable recipient markers, built for Cloudflare
Workers, R2 and D1. The first file handler supports Android APKs.

InkParcel identifies the issuance record associated with a surviving marker. It
does not prevent marker removal, credential sharing, or prove who leaked a file.

## Project status

Initial implementation in progress. The behavior and acceptance requirements are
defined in [SPEC](docs/SPEC.md); shared HTTP contracts are in [API](docs/API.md).

## License

Apache-2.0. Deployment operators retain responsibility for the files they distribute.

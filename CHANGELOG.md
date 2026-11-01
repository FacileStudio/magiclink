# Changelog

## [Unreleased]

### Fixed

- `request` no longer rejects when `send`, `buildLink` or `onSendError` throws.
- Non-positive or non-finite config values throw a `RangeError` instead of disabling a limit.
- A non-string email is treated as unknown instead of throwing.
- The source typechecks in consumers that enable `exactOptionalPropertyTypes`.
- The memory store copies clock dates, so a clock reusing one `Date` cannot corrupt rows.

## [0.1.0] - 2026-11-01

### Added

- `createMagicLinks` with `request` and `consume`.
- `MagicLinkStore` and `MagicLinkDeps` contracts, and `createMemoryStore` for tests.
- Hashed single-use tokens, 15 minute default lifetime, supersession of older links.
- Uniform `request` result for known, unknown and rate limited emails, with equal store reads.
- Rate limits per email and per IP, defaults 5 and 20 per hour.
- `MagicLinkError` with code `invalid_or_expired` for every bad token.

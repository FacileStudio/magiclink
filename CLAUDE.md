# magiclink

Magic link sign-in tokens for the Facile Suite (TypeScript). Package `@facile/magiclink`. The Go sibling is `porte/magiclink`; both follow the contract in Ardoise `docs/plans/magic-link-auth.md`.

## Tech stack

- TypeScript 5.8, NodeNext, bun test, zero runtime dependencies (`node:crypto` only).

## Layout

```
src/
  index.ts          createMagicLinks, re-exports
  types.ts          MagicLinkStore, MagicLinkDeps, MagicLinkConfig, MagicLinkError
  memory-store.ts   createMemoryStore, the atomic in-memory store for tests
  index.test.ts
```

## Conventions

- Token: 32 random bytes, hex. Only the sha256 hash is stored.
- `consume` in the store is one atomic conditional update. The package never reads then writes.
- `request` returns `void` for known, unknown and rate limited emails, and does the same store reads for each.
- Every bad token raises `MagicLinkError` with code `invalid_or_expired`.
- The package never logs a user in. The app issues its own session from the returned user id, on a POST only.
- Imports use `.js` suffixes (NodeNext); bun resolves them to the `.ts` sources.

## Key commands

```bash
bun test && bun run typecheck && filet check .
```

## Gotchas

- `exports` points at `src`, so consumers need a TS-aware runtime (bun). `bun run build` emits `dist/` for checks only.
- The in-memory store takes a `clock` so rate limit windows follow the test clock.

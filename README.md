# magiclink

Magic link sign-in for the [Facile Suite](https://facile.studio) (TypeScript). Published as `@facile/magiclink`.

The package owns the hard parts: token handling, single use, rate limits and enumeration safety. The app owns users, mail, links and sessions. Zero runtime dependencies, `node:crypto` only, runs under bun.

## Install

```bash
bun add github:FacileStudio/magiclink#v0.1.0
```

The package exports its TypeScript source, so run it with bun.

## Use

```ts
import { createMagicLinks } from '@facile/magiclink';

const magicLinks = createMagicLinks(
  { ttlMinutes: 15, maxPerEmailPerHour: 5, maxPerIpPerHour: 20 },
  {
    store,
    findUserByEmail: (email) => db.findEligibleUser(email),
    send: (to, link) => mailer.sendMagicLink(to, link),
    buildLink: (token) => `${FRONTEND_URL}/login/verify?token=${token}`,
  }
);

await magicLinks.request('ada@example.com', { ip });
const { userId } = await magicLinks.consume(token);
```

`request` always resolves with `void`. `consume` resolves with the user id or throws `MagicLinkError` (code `invalid_or_expired`). The app then issues its own session.

## Config

| Field | Default | Meaning |
|---|---|---|
| `ttlMinutes` | `15` | Link lifetime |
| `maxPerEmailPerHour` | `5` | Request cap per user |
| `maxPerIpPerHour` | `20` | Request cap per source IP |

## Deps

| Field | Meaning |
|---|---|
| `store` | A `MagicLinkStore` |
| `findUserByEmail` | Receives a trimmed, lowercased email. Return `null` for anyone not eligible |
| `send` | Delivers the link. Not awaited by `request`, so mail latency does not leak |
| `buildLink` | Turns a raw token into the URL for the email |
| `clock` | Optional, defaults to `new Date()` |
| `onSendError` | Optional, called when `send` rejects |

## Store

Implement four methods. `consume` must be one atomic conditional update (`consumed_at IS NULL AND expires_at > now`), never a read then a write.

```ts
interface MagicLinkStore {
  create(link: { userId: string; tokenHash: string; expiresAt: Date; ip?: string }): Promise<void>;
  invalidateForUser(userId: string): Promise<void>;
  consume(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
  countSince(key: { userId?: string; ip?: string }, since: Date): Promise<number>;
}
```

`countSince` must count every link created since the given time, including consumed and invalidated ones. `createMemoryStore({ clock })` is a reference implementation for tests.

## Prisma store

Matches a model with `id`, `userId`, `tokenHash @unique`, `expiresAt`, `consumedAt?`, `ipAddress?`, `createdAt`.

```ts
import type { MagicLinkStore } from '@facile/magiclink';

export const prismaStore: MagicLinkStore = {
  async create({ userId, tokenHash, expiresAt, ip }) {
    await prisma.magicLink.create({ data: { userId, tokenHash, expiresAt, ipAddress: ip ?? null } });
  },
  async invalidateForUser(userId) {
    await prisma.magicLink.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  },
  async consume(tokenHash, now) {
    const { count } = await prisma.magicLink.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (count !== 1) return null;
    const row = await prisma.magicLink.findUnique({ where: { tokenHash }, select: { userId: true } });
    return row ? { userId: row.userId } : null;
  },
  async countSince({ userId, ip }, since) {
    return prisma.magicLink.count({
      where: { createdAt: { gte: since }, ...(userId && { userId }), ...(ip && { ipAddress: ip }) },
    });
  },
};
```

## Behaviour

- The token is 32 random bytes in hex. Only its sha256 hash is stored.
- A new request invalidates the user's older unconsumed links.
- An unknown email takes the same path as a known one: same store reads, a token is generated and hashed, nothing is stored or sent.
- Rate limited requests return silently, like any other.
- Config values must be positive finite numbers. `createMagicLinks` throws a `RangeError` otherwise, so a typo cannot switch a limit off.
- `send` runs after `request` returns its work. A throwing `send`, `buildLink` or `onSendError` never rejects `request` and never raises an unhandled rejection.

## Security notes

- Consume only on POST. A GET that signs in lets email scanners burn the token. Serve a confirm-button page and POST the token from it.
- The link is a bearer credential. Use HTTPS, send `Referrer-Policy: no-referrer` on the verify page, and strip the token from the address bar after reading it.
- Never log the raw token. The package never does.
- Pass `meta.ip` from your trusted proxy header. Without it the per-IP limit does not apply.
- Rate limits count stored links, so they are checked then written without a lock. A burst of parallel requests can exceed a limit by the burst size. Requests for unknown emails are not stored and so not counted.
- Timing: the unknown-email path makes the same reads and hashing as a known one but skips two store writes. A client that measures many requests could still tell them apart. If that matters, do not await `request` in the handler, or pad the response to a fixed time.
- Concurrent `request` calls for one user can leave more than one valid link, each single use and short lived.
- Your `consume` store method must be one conditional update. `createMemoryStore` shows the contract.
- The package exports TypeScript source and is checked in strict consumers (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

## Development

```bash
bun install
bun test
bun run typecheck
filet check .
```

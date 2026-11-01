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

## Behaviour

- The token is 32 random bytes in hex. Only its sha256 hash is stored.
- A new request invalidates the user's older unconsumed links.
- An unknown email takes the same path as a known one: same store reads, a token is generated and hashed, nothing is stored or sent.
- Rate limited requests return silently, like any other.
- Consume only on POST. A GET that signs in lets email scanners burn the token.

## Development

```bash
bun install
bun test
bun run typecheck
filet check .
```

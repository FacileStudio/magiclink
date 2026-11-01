import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MagicLinkError } from './types.js';
import type { MagicLinkConfig, MagicLinkDeps, MagicLinks } from './types.js';

export { createMemoryStore } from './memory-store.js';
export { MagicLinkError } from './types.js';
export type { MagicLinkConfig, MagicLinkDeps, MagicLinks, MagicLinkStore } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Builds the magic link service. `request` never reveals whether an email is
 * known and `consume` is the only way a token becomes a user id.
 */
export function createMagicLinks(config: MagicLinkConfig, deps: MagicLinkDeps): MagicLinks {
  const ttlMs = (config.ttlMinutes ?? 15) * 60 * 1000;
  const maxPerEmail = config.maxPerEmailPerHour ?? 5;
  const maxPerIp = config.maxPerIpPerHour ?? 20;
  const now = deps.clock ?? (() => new Date());

  async function overLimit(userId: string, ip: string | undefined, at: Date): Promise<boolean> {
    const since = new Date(at.getTime() - HOUR_MS);
    const [byUser, byIp] = await Promise.all([
      deps.store.countSince({ userId }, since),
      ip === undefined ? Promise.resolve(0) : deps.store.countSince({ ip }, since),
    ]);
    return byUser >= maxPerEmail || byIp >= maxPerIp;
  }

  function dispatch(to: string, token: string): void {
    deps.send(to, deps.buildLink(token)).catch((error: unknown) => deps.onSendError?.(error));
  }

  return {
    async request(email, meta) {
      const at = now();
      const user = await deps.findUserByEmail(email.trim().toLowerCase());
      const limited = await overLimit(user?.id ?? randomUUID(), meta?.ip, at);
      const token = randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      if (!user || limited) return;
      await deps.store.invalidateForUser(user.id);
      const expiresAt = new Date(at.getTime() + ttlMs);
      await deps.store.create({ userId: user.id, tokenHash, expiresAt, ip: meta?.ip });
      dispatch(user.email, token);
    },
    async consume(token) {
      const candidate = String(token).trim().toLowerCase();
      const found = TOKEN_PATTERN.test(candidate)
        ? await deps.store.consume(hashToken(candidate), now())
        : null;
      if (!found) throw new MagicLinkError();
      return { userId: found.userId };
    },
  };
}

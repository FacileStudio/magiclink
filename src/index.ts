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

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive number`);
  return value;
}

/**
 * Builds the magic link service. `request` never reveals whether an email is
 * known and `consume` is the only way a token becomes a user id.
 */
export function createMagicLinks(config: MagicLinkConfig, deps: MagicLinkDeps): MagicLinks {
  const ttlMs = positive('ttlMinutes', config.ttlMinutes ?? 15) * 60 * 1000;
  const maxPerEmail = positive('maxPerEmailPerHour', config.maxPerEmailPerHour ?? 5);
  const maxPerIp = positive('maxPerIpPerHour', config.maxPerIpPerHour ?? 20);
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
    const report = (error: unknown): void => {
      try {
        deps.onSendError?.(error);
      } catch {
        return;
      }
    };
    Promise.resolve()
      .then(() => deps.send(to, deps.buildLink(token)))
      .catch(report);
  }

  return {
    async request(email, meta) {
      const at = now();
      const user = await deps.findUserByEmail(String(email).trim().toLowerCase());
      const limited = await overLimit(user?.id ?? randomUUID(), meta?.ip, at);
      const token = randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      if (!user || limited) return;
      await deps.store.invalidateForUser(user.id);
      const expiresAt = new Date(at.getTime() + ttlMs);
      const ip = meta?.ip;
      await deps.store.create({ userId: user.id, tokenHash, expiresAt, ...(ip === undefined ? {} : { ip }) });
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

import type { MagicLinkStore } from './types.js';

interface Row {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string;
  createdAt: Date;
  consumedAt: Date | null;
}

/**
 * In-memory store for tests. `consume` checks and marks a row in one synchronous
 * step, so it models the atomic conditional update a database store must do.
 */
export function createMemoryStore(options: { clock?: () => Date } = {}): MagicLinkStore & {
  rows: readonly Row[];
} {
  const clock = options.clock ?? (() => new Date());
  const rows: Row[] = [];

  return {
    rows,
    async create(link) {
      rows.push({ ...link, createdAt: clock(), consumedAt: null });
    },
    async invalidateForUser(userId) {
      const now = clock();
      for (const row of rows) {
        if (row.userId === userId && row.consumedAt === null) row.consumedAt = now;
      }
    },
    async consume(tokenHash, now) {
      const row = rows.find(
        (r) => r.tokenHash === tokenHash && r.consumedAt === null && r.expiresAt > now
      );
      if (!row) return null;
      row.consumedAt = now;
      return { userId: row.userId };
    },
    async countSince(key, since) {
      return rows.filter(
        (r) =>
          r.createdAt >= since &&
          (key.userId === undefined || r.userId === key.userId) &&
          (key.ip === undefined || r.ip === key.ip)
      ).length;
    },
  };
}

export interface MagicLinkStore {
  create(link: { userId: string; tokenHash: string; expiresAt: Date; ip?: string }): Promise<void>;
  invalidateForUser(userId: string): Promise<void>;
  consume(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
  countSince(key: { userId?: string; ip?: string }, since: Date): Promise<number>;
}

export interface MagicLinkDeps {
  store: MagicLinkStore;
  findUserByEmail(email: string): Promise<{ id: string; email: string } | null>;
  send(to: string, link: string): Promise<void>;
  buildLink(token: string): string;
  clock?: () => Date;
  onSendError?: (error: unknown) => void;
}

export interface MagicLinkConfig {
  ttlMinutes?: number;
  maxPerEmailPerHour?: number;
  maxPerIpPerHour?: number;
}

export interface MagicLinks {
  request(email: string, meta?: { ip?: string }): Promise<void>;
  consume(token: string): Promise<{ userId: string }>;
}

export class MagicLinkError extends Error {
  readonly code = 'invalid_or_expired';

  constructor() {
    super('invalid_or_expired');
    this.name = 'MagicLinkError';
  }
}

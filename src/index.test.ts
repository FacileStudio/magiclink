import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMagicLinks, createMemoryStore, MagicLinkError } from './index.js';

function setup(config = {}) {
  let time = new Date('2026-01-01T12:00:00Z');
  const clock = () => time;
  const store = createMemoryStore({ clock });
  const sent: { to: string; link: string }[] = [];
  const users = [{ id: 'u1', email: 'ada@example.com' }, { id: 'u2', email: 'bob@example.com' }];
  const links = createMagicLinks(config, {
    store,
    clock,
    findUserByEmail: async (email) => users.find((u) => u.email === email) ?? null,
    send: async (to, link) => void sent.push({ to, link }),
    buildLink: (token) => `https://app.test/verify?token=${token}`,
  });
  const advance = (ms: number) => (time = new Date(time.getTime() + ms));
  const lastToken = () => sent[sent.length - 1]!.link.split('token=')[1]!;
  return { links, store, sent, advance, lastToken };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

describe('magic links', () => {
  test('a valid token consumes once, then fails', async () => {
    const { links, sent, lastToken } = setup();
    await links.request('ada@example.com');
    expect(sent).toHaveLength(1);
    expect(await links.consume(lastToken())).toEqual({ userId: 'u1' });
    expect(await failure(links.consume(lastToken()))).toBeInstanceOf(MagicLinkError);
  });

  test('only the sha256 hash is stored', async () => {
    const { links, store, lastToken } = setup();
    await links.request('ada@example.com');
    const token = lastToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(store.rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(store.rows)).not.toContain(token);
  });

  test('an expired token fails after the default 15 minutes', async () => {
    const { links, advance, lastToken } = setup();
    await links.request('ada@example.com');
    advance(14 * 60 * 1000);
    const token = lastToken();
    advance(2 * 60 * 1000);
    expect(await failure(links.consume(token))).toBeInstanceOf(MagicLinkError);
  });

  test('the lifetime is configurable', async () => {
    const { links, advance, lastToken } = setup({ ttlMinutes: 1 });
    await links.request('ada@example.com');
    advance(2 * 60 * 1000);
    expect(await failure(links.consume(lastToken()))).toBeInstanceOf(MagicLinkError);
  });

  test('unknown, malformed and expired tokens share one error', async () => {
    const { links, advance, lastToken } = setup();
    await links.request('ada@example.com');
    const token = lastToken();
    advance(20 * 60 * 1000);
    const errors = await Promise.all([
      failure(links.consume(token)),
      failure(links.consume('f'.repeat(64))),
      failure(links.consume('nope')),
      failure(links.consume('')),
    ]);
    for (const error of errors) {
      expect(error).toBeInstanceOf(MagicLinkError);
      expect((error as MagicLinkError).code).toBe('invalid_or_expired');
      expect((error as Error).message).toBe('invalid_or_expired');
    }
  });

  test('a new request supersedes the old link', async () => {
    const { links, sent } = setup();
    await links.request('ada@example.com');
    await links.request('ada@example.com');
    const [first, second] = sent.map((s) => s.link.split('token=')[1]!);
    expect(await failure(links.consume(first!))).toBeInstanceOf(MagicLinkError);
    expect(await links.consume(second!)).toEqual({ userId: 'u1' });
  });

  test('superseding one user leaves another user links alone', async () => {
    const { links, sent } = setup();
    await links.request('ada@example.com');
    await links.request('bob@example.com');
    await links.request('ada@example.com');
    expect(await links.consume(sent[1]!.link.split('token=')[1]!)).toEqual({ userId: 'u2' });
  });

  test('an unknown email sends nothing, returns the same value and does not throw', async () => {
    const { links, sent, store } = setup();
    const known = await links.request('ada@example.com');
    const unknown = await links.request('ghost@example.com');
    expect(unknown).toBe(known);
    expect(sent).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  test('the email is trimmed and lowercased', async () => {
    const { links, sent } = setup();
    await links.request('  Ada@Example.COM ');
    expect(sent).toHaveLength(1);
  });

  test('the per-email limit trips after the configured count', async () => {
    const { links, sent, advance } = setup({ maxPerEmailPerHour: 2 });
    for (let i = 0; i < 4; i++) await links.request('ada@example.com');
    expect(sent).toHaveLength(2);
    advance(61 * 60 * 1000);
    await links.request('ada@example.com');
    expect(sent).toHaveLength(3);
  });

  test('the default per-email limit is 5 an hour', async () => {
    const { links, sent } = setup();
    for (let i = 0; i < 7; i++) await links.request('ada@example.com');
    expect(sent).toHaveLength(5);
  });

  test('the per-ip limit trips across emails', async () => {
    const { links, sent } = setup({ maxPerIpPerHour: 2 });
    await links.request('ada@example.com', { ip: '1.1.1.1' });
    await links.request('bob@example.com', { ip: '1.1.1.1' });
    await links.request('ada@example.com', { ip: '1.1.1.1' });
    await links.request('ada@example.com', { ip: '2.2.2.2' });
    expect(sent).toHaveLength(3);
  });

  test('the default per-ip limit is 20 an hour', async () => {
    const { links, sent } = setup({ maxPerEmailPerHour: 100 });
    for (let i = 0; i < 25; i++) await links.request('ada@example.com', { ip: '1.1.1.1' });
    expect(sent).toHaveLength(20);
  });

  test('a rate limited request looks like any other', async () => {
    const { links } = setup({ maxPerEmailPerHour: 1 });
    await links.request('ada@example.com');
    expect(await links.request('ada@example.com')).toBeUndefined();
  });

  test('unknown and known emails do the same store reads', async () => {
    const reads: string[] = [];
    const store = createMemoryStore();
    const counting = { ...store, countSince: async (...a: Parameters<typeof store.countSince>) => {
      reads.push(JSON.stringify(Object.keys(a[0])));
      return store.countSince(...a);
    } };
    const links = createMagicLinks({}, {
      store: counting,
      findUserByEmail: async (e) => (e === 'ada@example.com' ? { id: 'u1', email: e } : null),
      send: async () => {},
      buildLink: (t) => t,
    });
    await links.request('ada@example.com', { ip: '1.1.1.1' });
    const known = reads.splice(0);
    await links.request('ghost@example.com', { ip: '1.1.1.1' });
    expect(reads).toEqual(known);
  });

  test('a send failure does not reject request and reaches onSendError', async () => {
    const store = createMemoryStore();
    const errors: unknown[] = [];
    const links = createMagicLinks({}, {
      store,
      onSendError: (e) => errors.push(e),
      findUserByEmail: async (e) => ({ id: 'u1', email: e }),
      send: async () => { throw new Error('smtp down'); },
      buildLink: (t) => t,
    });
    await links.request('ada@example.com');
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });

  test('concurrent double consume: exactly one succeeds', async () => {
    const { links, lastToken } = setup();
    await links.request('ada@example.com');
    const token = lastToken();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => links.consume(token)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(9);
  });
});

import { describe, expect, test } from 'bun:test';
import { createMagicLinks, createMemoryStore } from './index.js';

function setup() {
  const sent: string[] = [];
  const links = createMagicLinks({}, {
    store: createMemoryStore(),
    findUserByEmail: async (e) => (e === 'ada@example.com' ? { id: 'u1', email: e } : null),
    send: async (to) => void sent.push(to),
    buildLink: (t) => t,
  });
  return { links, sent };
}

describe('hardening', () => {
  test('invalid config is refused instead of disabling limits', () => {
    const deps = {
      store: createMemoryStore(),
      findUserByEmail: async () => null,
      send: async () => {},
      buildLink: (t: string) => t,
    };
    for (const bad of [{ ttlMinutes: 0 }, { ttlMinutes: -1 }, { maxPerEmailPerHour: NaN }, { maxPerIpPerHour: 0 }]) {
      expect(() => createMagicLinks(bad, deps)).toThrow(RangeError);
    }
  });

  test('a non-string email is treated as unknown and does not throw', async () => {
    const { links, sent } = setup();
    await links.request(undefined as unknown as string);
    await links.request({ a: 1 } as unknown as string);
    expect(sent).toHaveLength(0);
  });

  test('a send that throws synchronously never rejects request or leaks', async () => {
    const errors: unknown[] = [];
    const links = createMagicLinks({}, {
      store: createMemoryStore(),
      onSendError: (e) => errors.push(e),
      findUserByEmail: async (e) => ({ id: 'u1', email: e }),
      send: () => { throw new Error('sync boom'); },
      buildLink: (t) => t,
    });
    await links.request('ada@example.com');
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
  });

  test('a buildLink or onSendError that throws causes no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', listener);
    const links = createMagicLinks({}, {
      store: createMemoryStore(),
      onSendError: () => { throw new Error('handler boom'); },
      findUserByEmail: async (e) => ({ id: 'u1', email: e }),
      send: async () => { throw new Error('smtp'); },
      buildLink: () => { throw new Error('link boom'); },
    });
    await links.request('ada@example.com');
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', listener);
    expect(unhandled).toHaveLength(0);
  });

  test('the memory store is not corrupted by a clock that mutates one Date', async () => {
    const shared = new Date('2026-01-01T12:00:00Z');
    const store = createMemoryStore({ clock: () => shared });
    await store.create({ userId: 'u1', tokenHash: 'h', expiresAt: new Date('2030-01-01') });
    shared.setTime(shared.getTime() + 2 * 3600 * 1000);
    expect(await store.countSince({ userId: 'u1' }, new Date('2026-01-01T11:00:00Z'))).toBe(1);
    expect(await store.countSince({ userId: 'u1' }, new Date('2026-01-01T13:00:00Z'))).toBe(0);
  });
});

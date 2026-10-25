import { describe, expect, test } from 'vitest';
import { PAIRING_ALPHABET, PAIRING_MAX_FAILURES, PAIRING_TTL_MS } from '@ai-office/shared';
import { PairingGate, generateCode, type PairingTicket } from './pairing';

let clock = 1000;
const fast = async (): Promise<Buffer> => Buffer.alloc(32, 7);
const gate = (): PairingGate => new PairingGate(() => clock, PAIRING_MAX_FAILURES, PAIRING_TTL_MS, fast);

describe('generateCode', () => {
  test('uses the alphabet only and is not constant', () => {
    const codes = new Set(Array.from({ length: 50 }, generateCode));
    for (const code of codes) {
      expect(code).toHaveLength(8);
      for (const char of code) expect(PAIRING_ALPHABET).toContain(char);
    }
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe('PairingGate', () => {
  test('has no code until one is opened, and says so', () => {
    const g = gate();
    expect(g.status()).toBeUndefined();
    expect(g.ticket()).toBe('not-pairing');
  });

  test('a code lives ten minutes', async () => {
    const g = gate();
    const status = await g.open();
    clock = 1000;
    expect(status.expiresAt).toBeGreaterThan(clock);

    clock = status.expiresAt - 1;
    expect(typeof g.ticket()).toBe('object');
    clock = status.expiresAt;
    expect(g.ticket()).toBe('not-pairing');
  });

  test('exactly one of several holders of a ticket can use the code up', async () => {
    const g = gate();
    await g.open();
    const a = g.ticket() as PairingTicket;
    const b = g.ticket() as PairingTicket;

    expect([g.consume(a), g.consume(b)]).toEqual([true, false]);
    expect(g.ticket()).toBe('not-pairing');
  });

  test('a ticket of a replaced code is dead', async () => {
    const g = gate();
    await g.open();
    const old = g.ticket() as PairingTicket;
    await g.open();

    expect(g.consume(old)).toBe(false);
    expect(g.fail(old)).toBe(false);
  });

  test('the maximum of wrong proofs wipes the code and its key', async () => {
    const g = gate();
    await g.open();
    const ticket = g.ticket() as PairingTicket;
    for (let i = 0; i < PAIRING_MAX_FAILURES - 1; i++) expect(g.fail(ticket)).toBe(false);

    expect(g.fail(ticket)).toBe(true);

    expect(g.ticket()).toBe('pairing-locked');
    expect(g.status()).toMatchObject({ locked: true, code: '' });
    expect(ticket.key.every((byte) => byte === 0)).toBe(true);
    expect(g.consume(ticket)).toBe(false);
  });

  test('closing destroys the code', async () => {
    const g = gate();
    await g.open();
    g.close();
    expect(g.ticket()).toBe('not-pairing');
  });
});

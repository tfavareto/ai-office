import { describe, expect, test } from 'vitest';
import { PAIRING_ALPHABET, PAIRING_TTL_MS } from '@ai-office/shared';
import { PairingGate, generateCode, type PairingOptions, type PairingTicket } from './pairing';

let clock = 1000;
const fast = async (): Promise<Buffer> => Buffer.alloc(32, 7);
const gate = (options: PairingOptions = {}): PairingGate =>
  new PairingGate(() => clock, { stretch: fast, monotonic: () => clock, ...options });
const ticketOf = (g: PairingGate, address = '10.0.0.1'): PairingTicket => g.ticket(address) as PairingTicket;

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
    expect(g.isOpen()).toBe(false);
    expect(g.ticket('10.0.0.1')).toBe('not-pairing');
  });

  test('a code lives ten minutes by the monotonic clock', async () => {
    clock = 1000;
    const g = gate();
    const status = await g.open();

    expect(status.expiresAt).toBe(1000 + PAIRING_TTL_MS);
    clock = 1000 + PAIRING_TTL_MS - 1;
    expect(typeof g.ticket('10.0.0.1')).toBe('object');
    clock = 1000 + PAIRING_TTL_MS;
    expect(g.ticket('10.0.0.1')).toBe('not-pairing');
    expect(g.isOpen()).toBe(false);
  });

  test('moving the wall clock does not move the expiry', async () => {
    let wall = 5_000_000;
    let mono = 0;
    const g = new PairingGate(() => wall, { stretch: fast, monotonic: () => mono });
    await g.open();

    wall += 3 * PAIRING_TTL_MS;
    expect(typeof g.ticket('10.0.0.1')).toBe('object');
    mono += PAIRING_TTL_MS;
    expect(g.ticket('10.0.0.1')).toBe('not-pairing');
  });

  test('exactly one of several holders of a ticket can claim the code', async () => {
    const g = gate();
    await g.open();
    const a = ticketOf(g);
    const b = ticketOf(g);

    expect([g.claim(a), g.claim(b)]).toEqual([true, false]);
    expect(g.ticket('10.0.0.9')).toBe('not-pairing');
  });

  test('a claim that stored its member uses the code up; one that failed gives it back', async () => {
    const g = gate();
    await g.open();
    const a = ticketOf(g);
    g.claim(a);
    g.finish(a, false);

    const b = ticketOf(g);
    expect(g.claim(b)).toBe(true);
    g.finish(b, true);

    expect(g.ticket('10.0.0.1')).toBe('not-pairing');
  });

  test('a ticket of a replaced code is dead', async () => {
    const g = gate();
    await g.open();
    const old = ticketOf(g);
    await g.open();

    expect(g.claim(old)).toBe(false);
    expect(g.fail(old, '10.0.0.1')).toBe(false);
  });

  test('wrong proofs lock the code for their address only', async () => {
    const g = gate({ perAddress: 3, destroyAfter: 100 });
    await g.open();
    const ticket = ticketOf(g, '10.0.0.66');
    expect([g.fail(ticket, '10.0.0.66'), g.fail(ticket, '10.0.0.66'), g.fail(ticket, '10.0.0.66')]).toEqual([
      false,
      false,
      true,
    ]);

    expect(g.ticket('10.0.0.66')).toBe('pairing-locked');
    expect(typeof g.ticket('10.0.0.7')).toBe('object');
    expect(g.status()).toMatchObject({ locked: false });
    expect(g.status()?.code).not.toBe('');
  });

  test('a flood of wrong proofs from many addresses destroys the code and wipes its key', async () => {
    const g = gate({ perAddress: 5, destroyAfter: 4 });
    await g.open();
    const ticket = ticketOf(g);
    for (let i = 0; i < 3; i++) expect(g.fail(ticket, `10.0.0.${i}`)).toBe(false);

    expect(g.fail(ticket, '10.0.0.9')).toBe(true);

    expect(g.ticket('10.0.0.50')).toBe('pairing-locked');
    expect(g.status()).toMatchObject({ locked: true, code: '' });
    expect(ticket.key.every((byte) => byte === 0)).toBe(true);
    expect(g.claim(ticket)).toBe(false);
    expect(g.isOpen()).toBe(false);
  });

  test('a new code starts every address clean', async () => {
    const g = gate({ perAddress: 1 });
    await g.open();
    g.fail(ticketOf(g, '10.0.0.66'), '10.0.0.66');
    expect(g.ticket('10.0.0.66')).toBe('pairing-locked');

    await g.open();

    expect(typeof g.ticket('10.0.0.66')).toBe('object');
  });

  test('closing destroys the code', async () => {
    const g = gate();
    await g.open();
    g.close();
    expect(g.ticket('10.0.0.1')).toBe('not-pairing');
  });
});

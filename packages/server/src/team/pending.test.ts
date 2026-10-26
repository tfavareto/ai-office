import { describe, expect, test } from 'vitest';
import { PendingGate, subnetOf } from './pending';

let clock = 0;
const limits = { max: 6, perAddress: 2, perSubnet: 4, reserve: 2 };
const gate = (): PendingGate => new PendingGate(() => clock, limits);
const noop = (): void => undefined;

describe('PendingGate', () => {
  test('one address cannot hold more than its share', () => {
    const g = gate();
    expect(g.admit('10.0.0.5', noop)).toBeDefined();
    expect(g.admit('10.0.0.5', noop)).toBeDefined();
    expect(g.admit('10.0.0.5', noop)).toBeUndefined();
  });

  test('at the subnet cap a newcomer from another address takes the place of the oldest of the busiest address', () => {
    const g = gate();
    const dropped: string[] = [];
    clock = 1;
    g.admit('10.0.0.1', () => dropped.push('1-old'));
    clock = 2;
    g.admit('10.0.0.1', () => dropped.push('1-new'));
    clock = 3;
    g.admit('10.0.0.2', () => dropped.push('2'));
    g.admit('10.0.0.3', () => dropped.push('3'));

    const victimSubnetNewcomer = g.admit('10.0.0.9', noop);

    expect(victimSubnetNewcomer).toBeDefined();
    expect(dropped).toEqual(['1-old']);
    expect(g.admit('10.0.1.3', noop)).toBeDefined();
  });

  test('aliases in a subnet each holding a slot cannot lock out a newcomer of that subnet', () => {
    const g = gate();
    const dropped: string[] = [];
    for (const [i, last] of [1, 2, 3, 4].entries()) {
      clock = i;
      g.admit(`10.0.0.${last}`, () => dropped.push(String(last)));
    }

    expect(g.admit('10.0.0.50', noop)).toBeDefined();
    expect(dropped).toEqual(['1']);
  });

  test('the newcomer is refused only when its own address is the busiest of the subnet', () => {
    const g = new PendingGate(() => clock, { max: 20, perAddress: 3, perSubnet: 4, reserve: 0 });
    for (const last of [1, 1, 1, 2]) g.admit(`10.0.0.${last}`, noop);

    expect(g.admit('10.0.0.1', noop)).toBeUndefined();
    expect(g.admit('10.0.0.2', noop)).toBeDefined();
  });

  test('when full, the oldest connection of the busiest address is dropped for a newcomer', () => {
    const g = gate();
    const dropped: string[] = [];
    clock = 1;
    g.admit('10.0.0.1', () => dropped.push('a-old'));
    clock = 2;
    g.admit('10.0.0.1', () => dropped.push('a-new'));
    for (const [i, subnet] of [
      [3, 1],
      [4, 2],
      [5, 3],
      [6, 4],
    ] as const)
      g.admit(`10.${subnet}.0.${i}`, () => dropped.push(`other-${i}`));

    const admitted = g.admit('10.9.0.9', noop);

    expect(admitted).toBeDefined();
    expect(dropped).toEqual(['a-old']);
    expect(g.size).toBe(6);
  });

  test('idle connections held by one address cannot keep a different address out', () => {
    const g = gate();
    for (let i = 0; i < 6; i++) g.admit(`10.${i}.0.1`, noop);

    expect(g.admit('172.16.0.2', noop)).toBeDefined();
  });

  test('addresses that authenticated lately are never evicted and may use the reserve', () => {
    const g = gate();
    g.markTrusted('192.168.0.50');
    const dropped: string[] = [];
    for (let i = 0; i < 6; i++) g.admit(i === 0 ? '192.168.0.50' : `10.${i}.0.1`, () => dropped.push(String(i)));

    expect(g.admit('192.168.0.50', noop)).toBeDefined();
    expect(g.admit('10.9.0.9', noop)).toBeDefined();
    expect(dropped).not.toContain('0');
  });

  test('a trusted address is forgotten after ten minutes, and release frees the slot', () => {
    const g = gate();
    g.markTrusted('10.0.0.8');
    clock = 11 * 60_000;
    const release = g.admit('10.0.0.8', noop);
    g.admit('10.0.0.8', noop);

    expect(g.admit('10.0.0.8', noop)).toBeUndefined();
    release?.();
    expect(g.admit('10.0.0.8', noop)).toBeDefined();
  });

  test('subnetOf cuts IPv4 to /24', () => {
    expect(subnetOf('192.168.1.7')).toBe('192.168.1');
  });
});

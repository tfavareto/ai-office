import { describe, expect, test } from 'vitest';
import { isLoopbackAddress, isTeamAddress, lanInterfaces, parseHostPort } from './addresses';

describe('isTeamAddress', () => {
  test.each([
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.3.4',
    '100.64.0.1',
    '100.127.255.1',
    '127.0.0.1',
  ])('accepts %s', (address) => expect(isTeamAddress(address)).toBe(true));

  test.each([
    '8.8.8.8',
    '172.32.0.1',
    '172.15.0.1',
    '100.128.0.1',
    '192.169.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '::1',
    'fe80::1',
    'localhost',
    'example.com',
    '192.168.1',
    '192.168.1.1.1',
    '',
    '192.168.1.256',
  ])('refuses %s', (address) => expect(isTeamAddress(address)).toBe(false));

  test('only 127/8 is loopback', () => {
    expect(isLoopbackAddress('127.9.9.9')).toBe(true);
    expect(isLoopbackAddress('192.168.0.1')).toBe(false);
  });
});

describe('parseHostPort', () => {
  test('takes an address with or without a port and falls back to the default', () => {
    expect(parseHostPort('192.168.0.12:4850')).toEqual({ address: '192.168.0.12', port: 4850 });
    expect(parseHostPort(' 192.168.0.12 ')).toEqual({ address: '192.168.0.12', port: 4849 });
    expect(parseHostPort('192.168.0.12', 5000)).toEqual({ address: '192.168.0.12', port: 5000 });
  });

  test('refuses names, public addresses, wildcards and bad ports', () => {
    for (const bad of [
      'host.local',
      'example.com:4849',
      '8.8.8.8',
      '0.0.0.0',
      '192.168.0.12:80',
      '192.168.0.12:99999',
      '192.168.0.12:abc',
      '[::1]:4849',
      '192.168.0.12:',
    ])
      expect(parseHostPort(bad), bad).toBeUndefined();
  });
});

describe('lanInterfaces', () => {
  test('lists only usable IPv4 addresses, loopback only on request', () => {
    const quiet = lanInterfaces(false);
    const all = lanInterfaces(true);

    expect(quiet.every((entry) => isTeamAddress(entry.address) && !isLoopbackAddress(entry.address))).toBe(true);
    expect(all.some((entry) => entry.address === '127.0.0.1')).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(quiet.length);
  });
});

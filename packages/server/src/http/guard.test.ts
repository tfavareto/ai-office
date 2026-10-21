import type { IncomingMessage } from 'node:http';
import { describe, expect, test } from 'vitest';
import { guardRequest, parseHostHeader } from './guard';

function req(method: string, headers: Record<string, string>, remote = '127.0.0.1'): IncomingMessage {
  return { method, headers, socket: { remoteAddress: remote } } as unknown as IncomingMessage;
}

const options = { port: 4848, bindHost: '127.0.0.1' };
const json = { 'content-type': 'application/json' };

describe('guardRequest', () => {
  test('parses Host headers including IPv6', () => {
    expect(parseHostHeader('localhost:4848')).toEqual({ hostname: 'localhost', port: '4848' });
    expect(parseHostHeader('[::1]:4848')).toEqual({ hostname: '::1', port: '4848' });
    expect(parseHostHeader('example.com')).toEqual({ hostname: 'example.com', port: undefined });
  });

  test('allows loopback hosts with the right port and marks them local', () => {
    for (const host of ['localhost:4848', '127.0.0.1:4848', '[::1]:4848']) {
      expect(guardRequest(req('GET', { host }), options)).toEqual({ ok: true, local: true });
    }
  });

  test('rejects other hosts, wrong ports and missing Host (DNS rebinding)', () => {
    expect(guardRequest(req('GET', { host: 'evil.com:4848' }), options)).toMatchObject({
      ok: false,
      status: 403,
      error: 'host-not-allowed',
    });
    expect(guardRequest(req('GET', { host: 'localhost:9999' }), options)).toMatchObject({ ok: false, status: 403 });
    expect(guardRequest(req('GET', { host: 'localhost' }), options)).toMatchObject({ ok: false });
    expect(guardRequest(req('GET', {}), options)).toMatchObject({ ok: false });
  });

  test('POST requires a JSON content type', () => {
    expect(guardRequest(req('POST', { host: 'localhost:4848' }), options)).toMatchObject({ ok: false, status: 415 });
    expect(guardRequest(req('POST', { host: 'localhost:4848', 'content-type': 'text/plain' }), options)).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(
      guardRequest(req('POST', { host: 'localhost:4848', 'content-type': 'application/json; charset=utf-8' }), options),
    ).toMatchObject({ ok: true });
  });

  test('POST requires the page itself as Origin, or no Origin (hooks)', () => {
    const host = 'localhost:4848';
    expect(guardRequest(req('POST', { host, ...json, origin: 'http://localhost:4848' }), options)).toMatchObject({
      ok: true,
    });
    expect(guardRequest(req('POST', { host, ...json }), options)).toMatchObject({ ok: true });
    expect(guardRequest(req('POST', { host, ...json, origin: 'http://evil.com' }), options)).toMatchObject({
      ok: false,
      status: 403,
      error: 'origin-not-allowed',
    });
  });

  test('Sec-Fetch-Site must be same-origin or none when present', () => {
    const host = 'localhost:4848';
    for (const site of ['same-origin', 'none'])
      expect(guardRequest(req('GET', { host, 'sec-fetch-site': site }), options)).toMatchObject({ ok: true });
    for (const site of ['cross-site', 'same-site', 'weird'])
      expect(guardRequest(req('GET', { host, 'sec-fetch-site': site }), options)).toMatchObject({
        ok: false,
        status: 403,
        error: 'cross-site',
      });
    expect(guardRequest(req('GET', { host }), options)).toMatchObject({ ok: true });
  });

  test('a wildcard bind never trusts arbitrary Host names (DNS rebinding), only IP literals and loopback', () => {
    const wide = { port: 4848, bindHost: '0.0.0.0' };
    expect(guardRequest(req('GET', { host: 'evil.example:4848' }), wide)).toMatchObject({
      ok: false,
      status: 403,
      error: 'host-not-allowed',
    });
    expect(guardRequest(req('GET', { host: 'rebind.attacker.test:4848' }), wide)).toMatchObject({ ok: false });
    expect(guardRequest(req('GET', { host: '[fd00::5]:4848' }), wide)).toMatchObject({ ok: true });
    expect(guardRequest(req('GET', { host: 'localhost:4848' }), wide)).toMatchObject({ ok: true });
  });

  test('a specific non-loopback bind trusts only that address', () => {
    const lan = { port: 4848, bindHost: '192.168.1.5' };
    expect(guardRequest(req('GET', { host: '192.168.1.5:4848' }), lan)).toMatchObject({ ok: true });
    expect(guardRequest(req('GET', { host: '192.168.1.6:4848' }), lan)).toMatchObject({ ok: false });
    expect(guardRequest(req('GET', { host: 'evil.example:4848' }), lan)).toMatchObject({ ok: false });
  });

  test('rejects cross-site fetches and unsupported methods', () => {
    expect(guardRequest(req('GET', { host: 'localhost:4848', 'sec-fetch-site': 'cross-site' }), options)).toMatchObject(
      { ok: false, status: 403 },
    );
    expect(guardRequest(req('PUT', { host: 'localhost:4848' }), options)).toMatchObject({ ok: false, status: 405 });
    expect(guardRequest(req('OPTIONS', { host: 'localhost:4848' }), options)).toMatchObject({ ok: false, status: 405 });
  });

  test('PATCH needs JSON like POST, DELETE only the origin check, and neither accepts a foreign origin', () => {
    const host = 'localhost:4848';
    expect(guardRequest(req('PATCH', { host }), options)).toMatchObject({ ok: false, status: 415 });
    expect(guardRequest(req('PATCH', { host, 'content-type': 'application/json' }), options)).toMatchObject({
      ok: true,
    });
    expect(
      guardRequest(req('PATCH', { host, 'content-type': 'application/json', origin: 'http://evil.example' }), options),
    ).toMatchObject({ ok: false, status: 403 });
    expect(guardRequest(req('DELETE', { host }), options)).toMatchObject({ ok: true });
    expect(guardRequest(req('DELETE', { host, origin: 'http://evil.example' }), options)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(guardRequest(req('DELETE', { host, 'sec-fetch-site': 'cross-site' }), options)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test('local-only features need a loopback bind, Host and peer', () => {
    expect(guardRequest(req('GET', { host: 'localhost:4848' }, '192.168.1.20'), options)).toEqual({
      ok: true,
      local: false,
    });
    expect(guardRequest(req('GET', { host: 'localhost:4848' }, '::ffff:127.0.0.1'), options)).toEqual({
      ok: true,
      local: true,
    });
    const wide = { port: 4848, bindHost: '0.0.0.0' };
    expect(guardRequest(req('GET', { host: 'localhost:4848' }), wide)).toEqual({ ok: true, local: false });
    expect(guardRequest(req('GET', { host: '192.168.1.5:4848' }), wide)).toEqual({ ok: true, local: false });
    expect(guardRequest(req('GET', { host: '192.168.1.5:4848' }), options)).toMatchObject({ ok: false });
  });
});

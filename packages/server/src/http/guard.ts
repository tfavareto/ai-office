// Request guard: Host allowlist (DNS rebinding), Sec-Fetch-Site, JSON-only and same-origin writes, local-only detection.
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { isLoopbackHost, isWildcardHost } from '../config';

export interface GuardOptions {
  port: number;
  bindHost: string;
}

export type GuardResult = { ok: true; local: boolean } | { ok: false; status: number; error: string };

const SAFE_METHODS = new Set(['GET', 'HEAD']);
/** Writes that carry a JSON body. DELETE has none, but gets the same origin check. */
const JSON_METHODS = new Set(['POST', 'PATCH']);
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
/** Sec-Fetch-Site values of requests made by the page itself or typed in the address bar. */
const TRUSTED_FETCH_SITES = new Set(['same-origin', 'none']);

/** Splits a Host header into hostname and port ("[::1]:4848" -> "::1", "4848"). */
export function parseHostHeader(value: string): { hostname: string; port: string | undefined } {
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    const hostname = value.slice(1, end < 0 ? undefined : end);
    const rest = end < 0 ? '' : value.slice(end + 1);
    return { hostname, port: rest.startsWith(':') ? rest.slice(1) : undefined };
  }
  const colon = value.lastIndexOf(':');
  return colon < 0
    ? { hostname: value, port: undefined }
    : { hostname: value.slice(0, colon), port: value.slice(colon + 1) };
}

function isHostAllowed(header: string, options: GuardOptions): boolean {
  const { hostname, port } = parseHostHeader(header.toLowerCase());
  if (port !== undefined && port !== String(options.port)) return false;
  if (port === undefined && options.port !== 80) return false;
  if (isLoopbackHost(hostname)) return true;
  const bound = options.bindHost.toLowerCase().replace(/^\[|\]$/g, '');
  // A wildcard bind accepts IP literals only: DNS rebinding needs a name, so arbitrary names are never trusted.
  if (isWildcardHost(options.bindHost)) return isIP(hostname) !== 0;
  return hostname === bound;
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address.startsWith('::ffff:127.') ||
    /^127(\.\d{1,3}){3}$/.test(address)
  );
}

export function guardRequest(req: IncomingMessage, options: GuardOptions): GuardResult {
  const host = req.headers.host;
  if (host === undefined || !isHostAllowed(host, options)) return { ok: false, status: 403, error: 'host-not-allowed' };
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite !== undefined && !TRUSTED_FETCH_SITES.has(String(fetchSite).toLowerCase()))
    return { ok: false, status: 403, error: 'cross-site' };
  const method = req.method ?? 'GET';
  if (!SAFE_METHODS.has(method)) {
    if (!WRITE_METHODS.has(method)) return { ok: false, status: 405, error: 'method-not-allowed' };
    const type = req.headers['content-type'] ?? '';
    if (JSON_METHODS.has(method) && !type.toLowerCase().startsWith('application/json'))
      return { ok: false, status: 415, error: 'json-required' };
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`)
      return { ok: false, status: 403, error: 'origin-not-allowed' };
  }
  const { hostname } = parseHostHeader(host);
  const local =
    isLoopbackHost(options.bindHost) && isLoopbackHost(hostname) && isLoopbackAddress(req.socket.remoteAddress);
  return { ok: true, local };
}

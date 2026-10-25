// Which addresses team mode may listen on and talk to. Only IPv4 literals of private, link-local, shared (CGNAT, e.g.
// Tailscale) and loopback ranges: never a public address, never a name (no DNS, so nothing can steer a connection to
// the internet), never a wildcard.
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { TEAM_DEFAULT_PORT, type LanInterface } from '@ai-office/shared';

function octets(address: string): [number, number, number, number] | undefined {
  if (!isIPv4(address)) return undefined;
  const parts = address.split('.').map(Number);
  return parts.length === 4
    ? [parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number]
    : undefined;
}

export function isLoopbackAddress(address: string): boolean {
  return octets(address)?.[0] === 127;
}

/** 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 and 127/8. */
export function isTeamAddress(address: string): boolean {
  const o = octets(address);
  if (o === undefined) return false;
  const [a, b] = o;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** 100.64.0.0/10: Tailscale uses it, but so does carrier-grade NAT, where other subscribers of the provider share it. */
export function isSharedAddress(address: string): boolean {
  const o = octets(address);
  return o !== undefined && o[0] === 100 && o[1] >= 64 && o[1] <= 127;
}

export interface HostPort {
  address: string;
  port: number;
}

/** `192.168.0.12` or `192.168.0.12:4849`; undefined for anything else (names, public addresses, bad ports). */
export function parseHostPort(raw: string, fallbackPort: number = TEAM_DEFAULT_PORT): HostPort | undefined {
  const text = raw.trim();
  const colon = text.lastIndexOf(':');
  const address = colon < 0 ? text : text.slice(0, colon);
  const port = colon < 0 ? fallbackPort : /^\d{1,5}$/.test(text.slice(colon + 1)) ? Number(text.slice(colon + 1)) : NaN;
  if (!isTeamAddress(address) || !isValidPort(port)) return undefined;
  return { address, port };
}

export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

/** The IPv4 addresses of this computer's interfaces that a team may use. Loopback only when asked (tests, demos). */
export function lanInterfaces(includeLoopback: boolean): LanInterface[] {
  const out: LanInterface[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || !isTeamAddress(entry.address)) continue;
      if (entry.internal && !includeLoopback) continue;
      out.push({ name, address: entry.address, ...(isSharedAddress(entry.address) ? { shared: true } : {}) });
    }
  }
  return out;
}

/** Whether the address belongs to an interface of this computer. */
export function isOwnAddress(address: string): boolean {
  return lanInterfaces(true).some((entry) => entry.address === address);
}

// Admission of connections that have not authenticated yet. Idle connections cost the host a slot, so a single computer
// must not be able to take them all: there are caps per address and per /24 subnet, the oldest connection of the busiest
// address is dropped when the total is reached, and addresses that authenticated recently get a small reserve.
import { MAX_PENDING, MAX_PENDING_PER_IP, MAX_PENDING_PER_SUBNET, PENDING_RESERVE, TRUSTED_ADDRESS_MS } from './limits';

export interface PendingLimits {
  max: number;
  perAddress: number;
  perSubnet: number;
  reserve: number;
}

export const DEFAULT_PENDING_LIMITS: PendingLimits = {
  max: MAX_PENDING,
  perAddress: MAX_PENDING_PER_IP,
  perSubnet: MAX_PENDING_PER_SUBNET,
  reserve: PENDING_RESERVE,
};

interface Entry {
  id: number;
  address: string;
  subnet: string;
  since: number;
  drop: () => void;
}

/** `192.168.1.7` -> `192.168.1`. */
export function subnetOf(address: string): string {
  const parts = address.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : address;
}

export class PendingGate {
  private readonly entries = new Map<number, Entry>();
  private readonly trusted = new Map<string, number>();
  private nextId = 1;

  constructor(
    private readonly now: () => number,
    private readonly limits: PendingLimits = DEFAULT_PENDING_LIMITS,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** An address that completed a handshake: it may use the reserve for a while. */
  markTrusted(address: string): void {
    this.trusted.set(address, this.now());
  }

  private isTrusted(address: string): boolean {
    const at = this.trusted.get(address);
    if (at === undefined) return false;
    if (this.now() - at <= TRUSTED_ADDRESS_MS) return true;
    this.trusted.delete(address);
    return false;
  }

  /** Admits a connection (returning its release function) or refuses it (undefined). `drop` closes it when evicted. */
  admit(address: string, drop: () => void): (() => void) | undefined {
    const subnet = subnetOf(address);
    const all = [...this.entries.values()];
    const known = this.isTrusted(address);
    if (all.filter((entry) => entry.address === address).length >= this.limits.perAddress + (known ? 1 : 0))
      return undefined;
    if (!known && all.filter((entry) => entry.subnet === subnet).length >= this.limits.perSubnet) return undefined;
    const capacity = this.limits.max + (known ? this.limits.reserve : 0);
    if (all.length >= capacity && !this.evict(all)) return undefined;
    const id = this.nextId++;
    this.entries.set(id, { id, address, subnet, since: this.now(), drop });
    return () => void this.entries.delete(id);
  }

  /** Drops the oldest connection of the address with the most of them, never one of a recently authenticated address. */
  private evict(all: readonly Entry[]): boolean {
    const counts = new Map<string, number>();
    for (const entry of all) counts.set(entry.address, (counts.get(entry.address) ?? 0) + 1);
    const candidates = all.filter((entry) => !this.isTrusted(entry.address));
    if (candidates.length === 0) return false;
    const busiest = Math.max(...candidates.map((entry) => counts.get(entry.address) ?? 0));
    const victim = candidates
      .filter((entry) => (counts.get(entry.address) ?? 0) === busiest)
      .reduce((oldest, entry) => (entry.since < oldest.since ? entry : oldest));
    this.entries.delete(victim.id);
    victim.drop();
    return true;
  }
}

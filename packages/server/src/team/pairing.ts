// The pairing code of a host: one at a time, 8 characters, single use, valid 10 minutes. The code itself is never sent
// anywhere: it is stretched with scrypt (the salt is public) into the key that authenticates the pairing handshake.
//
// Wrong proofs lock the code **for the address they came from** (after 5), so a stranger on the network cannot keep the
// pairing unusable for everybody by failing on purpose; only a flood of wrong proofs in all (60) destroys the code. The
// expiry follows a monotonic clock, so changing the system time cannot extend or shorten it.
import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  formatPairingCode,
  type PairingStatus,
} from '@ai-office/shared';
import { stretchCode } from './keys';
import { PAIRING_DESTROY_AFTER, PAIRING_LOCK_PER_ADDRESS } from './limits';

export interface PairingTicket {
  salt: Buffer;
  key: Buffer;
  /** Identity of the code the ticket came from: it stops working when the code is replaced, used or destroyed. */
  readonly id: number;
}

export type TicketRefusal = 'not-pairing' | 'pairing-locked';

interface Open {
  id: number;
  code: string;
  salt: Buffer;
  key: Buffer;
  /** Monotonic time at which the code expires. */
  expiresAtMono: number;
  /** Wrong proofs per source address, and in all. */
  failures: Map<string, number>;
  totalFailures: number;
  destroyed: boolean;
  /** A connection with a right proof is storing its member: nobody else may use the code meanwhile. */
  claimed: boolean;
}

export interface PairingOptions {
  /** Wrong proofs that lock the code for one address. */
  perAddress?: number;
  /** Wrong proofs in all that destroy the code. */
  destroyAfter?: number;
  ttlMs?: number;
  stretch?: (code: string, salt: Buffer) => Promise<Buffer>;
  /** Monotonic milliseconds (default: `performance.now`). */
  monotonic?: () => number;
}

/** Addresses remembered per code; beyond this only the total counts. */
const MAX_TRACKED = 256;

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}

export class PairingGate {
  private current: Open | undefined;
  private nextId = 1;
  private readonly perAddress: number;
  private readonly destroyAfter: number;
  private readonly ttlMs: number;
  private readonly stretch: (code: string, salt: Buffer) => Promise<Buffer>;
  private readonly monotonic: () => number;

  constructor(
    private readonly now: () => number,
    options: PairingOptions = {},
  ) {
    this.perAddress = options.perAddress ?? PAIRING_LOCK_PER_ADDRESS;
    this.destroyAfter = options.destroyAfter ?? PAIRING_DESTROY_AFTER;
    this.ttlMs = options.ttlMs ?? PAIRING_TTL_MS;
    this.stretch = options.stretch ?? stretchCode;
    this.monotonic = options.monotonic ?? (() => performance.now());
  }

  /** Replaces any code by a new one (the old one stops working at once, and every address starts clean). */
  async open(): Promise<PairingStatus> {
    const code = generateCode();
    const salt = randomBytes(16);
    const id = this.nextId++;
    this.current = undefined;
    const key = await this.stretch(code, salt);
    // A newer open() or a close() that ran meanwhile wins.
    if (this.nextId !== id + 1) return this.status() ?? { code: '', expiresAt: 0, locked: true };
    this.current = {
      id,
      code,
      salt,
      key,
      expiresAtMono: this.monotonic() + this.ttlMs,
      failures: new Map(),
      totalFailures: 0,
      destroyed: false,
      claimed: false,
    };
    return this.status() as PairingStatus;
  }

  close(): void {
    this.nextId++;
    this.current = undefined;
  }

  /** Whether there is a code a stranger could pair with right now (open, not expired, not destroyed). */
  isOpen(): boolean {
    const open = this.current;
    return open !== undefined && !open.destroyed && this.monotonic() < open.expiresAtMono;
  }

  /** What the page shows; undefined when there is no code (never opened, used, or closed). `locked`: destroyed. */
  status(): PairingStatus | undefined {
    const open = this.current;
    if (open === undefined) return undefined;
    const remaining = Math.max(0, open.expiresAtMono - this.monotonic());
    return {
      code: open.destroyed ? '' : formatPairingCode(open.code),
      expiresAt: this.now() + remaining,
      locked: open.destroyed,
    };
  }

  /** Hands the key to a connection that wants to pair, or says why not. */
  ticket(address: string): PairingTicket | TicketRefusal {
    const open = this.current;
    if (open === undefined || open.claimed || this.monotonic() >= open.expiresAtMono) return 'not-pairing';
    if (open.destroyed || (open.failures.get(address) ?? 0) >= this.perAddress) return 'pairing-locked';
    return { salt: open.salt, key: open.key, id: open.id };
  }

  /** A wrong proof from `address`. Returns true when it locked that address or destroyed the code. */
  fail(ticket: PairingTicket, address: string): boolean {
    const open = this.current;
    if (open === undefined || open.id !== ticket.id) return false;
    const tracked = open.failures.has(address) || open.failures.size < MAX_TRACKED;
    const count = (open.failures.get(address) ?? 0) + 1;
    if (tracked) open.failures.set(address, count);
    open.totalFailures++;
    if (open.totalFailures >= this.destroyAfter) {
      open.destroyed = true;
      open.key.fill(0);
      return true;
    }
    return tracked && count >= this.perAddress;
  }

  /** The proof was right: the code is held for this connection while it stores the member. True for exactly one caller. */
  claim(ticket: PairingTicket): boolean {
    const open = this.current;
    if (open === undefined || open.id !== ticket.id || open.claimed || open.destroyed) return false;
    if (this.monotonic() >= open.expiresAtMono) return false;
    open.claimed = true;
    return true;
  }

  /** The member was stored (`ok`: the code is used up) or not (the code works again for the next try). */
  finish(ticket: PairingTicket, ok: boolean): void {
    const open = this.current;
    if (open === undefined || open.id !== ticket.id || !open.claimed) return;
    if (ok) this.current = undefined;
    else open.claimed = false;
  }
}

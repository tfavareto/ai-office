// The pairing code of a host: one at a time, 8 characters, single use, valid 10 minutes, destroyed after 5 wrong proofs.
// The code itself is never sent anywhere. It is stretched with scrypt (the salt is public) into the key that
// authenticates the pairing handshake.
import { randomBytes, randomInt } from 'node:crypto';
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_MAX_FAILURES,
  PAIRING_TTL_MS,
  formatPairingCode,
  type PairingStatus,
} from '@ai-office/shared';
import { stretchCode } from './keys';

export interface PairingTicket {
  salt: Buffer;
  key: Buffer;
  /** Identity of the code the ticket came from: it stops working when the code is replaced, used or locked. */
  readonly id: number;
}

export type TicketRefusal = 'not-pairing' | 'pairing-locked';

interface Open {
  id: number;
  code: string;
  salt: Buffer;
  key: Buffer;
  expiresAt: number;
  failures: number;
  locked: boolean;
}

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}

export class PairingGate {
  private current: Open | undefined;
  private nextId = 1;

  constructor(
    private readonly now: () => number,
    private readonly maxFailures = PAIRING_MAX_FAILURES,
    private readonly ttlMs = PAIRING_TTL_MS,
    private readonly stretch: (code: string, salt: Buffer) => Promise<Buffer> = stretchCode,
  ) {}

  /** Replaces any code by a new one (the old one stops working at once). */
  async open(): Promise<PairingStatus> {
    const code = generateCode();
    const salt = randomBytes(16);
    const id = this.nextId++;
    this.current = undefined;
    const key = await this.stretch(code, salt);
    // A newer open() or a close() that ran meanwhile wins.
    if (this.nextId !== id + 1) return this.status() ?? { code: '', expiresAt: 0, locked: true };
    this.current = { id, code, salt, key, expiresAt: this.now() + this.ttlMs, failures: 0, locked: false };
    return this.status() as PairingStatus;
  }

  close(): void {
    this.nextId++;
    this.current = undefined;
  }

  /** What the page shows; undefined when there is no code (never opened, used, or closed). */
  status(): PairingStatus | undefined {
    const open = this.current;
    if (open === undefined) return undefined;
    return {
      code: open.locked ? '' : formatPairingCode(open.code),
      expiresAt: open.expiresAt,
      locked: open.locked,
    };
  }

  /** Hands the key to a connection that wants to pair, or says why not. */
  ticket(): PairingTicket | TicketRefusal {
    const open = this.current;
    if (open === undefined || this.now() >= open.expiresAt) return 'not-pairing';
    if (open.locked) return 'pairing-locked';
    return { salt: open.salt, key: open.key, id: open.id };
  }

  /** A wrong proof: enough of them destroy the code. Returns true when this one locked it. */
  fail(ticket: PairingTicket): boolean {
    const open = this.current;
    if (open === undefined || open.id !== ticket.id) return false;
    open.failures++;
    if (open.failures < this.maxFailures) return false;
    open.locked = true;
    open.key.fill(0);
    return true;
  }

  /** The proof was right: the code is used up. True for exactly one caller, whatever the timing. */
  consume(ticket: PairingTicket): boolean {
    const open = this.current;
    if (open === undefined || open.id !== ticket.id || open.locked || this.now() >= open.expiresAt) return false;
    this.current = undefined;
    return true;
  }
}

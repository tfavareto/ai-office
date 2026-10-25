// JSON messages inside frames, read defensively: a message is a plain object with a string `t`, nothing else is assumed.
import type { TeamErrorCode } from '@ai-office/shared';
import type { FramedConn } from './conn';

/** A protocol failure with the code the person sees. */
export class ProtocolError extends Error {
  constructor(readonly code: TeamErrorCode) {
    super(code);
  }
}

export type WireMessage = Record<string, unknown> & { t: string };

export function encode(message: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(message), 'utf8');
}

export function decode(frame: Buffer): WireMessage {
  let value: unknown;
  try {
    value = JSON.parse(frame.toString('utf8'));
  } catch {
    throw new ProtocolError('protocol-error');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProtocolError('protocol-error');
  const message = value as Record<string, unknown>;
  if (typeof message.t !== 'string' || message.t.length > 32) throw new ProtocolError('protocol-error');
  return message as WireMessage;
}

export function sendPlain(conn: FramedConn, message: Record<string, unknown>): void {
  conn.send(encode(message));
}

/** Refuses a message of another protocol version, and turns a peer's `error` message into a ProtocolError. */
export function expect(message: WireMessage, type: string): WireMessage {
  if (message.t === 'error') {
    const code = typeof message.code === 'string' ? message.code : 'protocol-error';
    throw new ProtocolError(PEER_CODES.has(code) ? (code as TeamErrorCode) : 'protocol-error');
  }
  if (message.t !== type) throw new ProtocolError('protocol-error');
  return message;
}

/** Codes a peer may report before the handshake is done. */
const PEER_CODES: ReadonlySet<string> = new Set<TeamErrorCode>([
  'not-pairing',
  'pairing-failed',
  'pairing-locked',
  'rate-limited',
  'version-mismatch',
  'team-full',
  'save-failed',
  'protocol-error',
]);

// The encrypted channel after the handshake: AES-256-GCM, one key per direction, a strictly increasing counter as the
// nonce. The counter is not sent: both ends count the frames, so a replayed, dropped, duplicated or reordered frame
// fails authentication and the connection ends. Keys are fresh for every connection (ephemeral X25519), so a counter
// is never reused under one key.
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { MAX_FRAMES_PER_KEY } from './limits';

const TAG_BYTES = 16;
export const SEAL_OVERHEAD = TAG_BYTES;

export class ChannelError extends Error {
  constructor(readonly reason: 'auth' | 'exhausted' | 'short') {
    super(reason);
  }
}

function nonceFor(counter: number): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(counter), 4);
  return nonce;
}

function aadFor(direction: number, length: number, extra: Uint8Array): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(direction, 0);
  head.writeUInt32BE(length, 1);
  return Buffer.concat([head, extra]);
}

/** One direction of a channel. `direction` (1 member->host, 2 host->member) is authenticated with every frame. */
class Lane {
  private counter = 0;

  constructor(
    private readonly key: Buffer,
    private readonly direction: number,
    private readonly context: Uint8Array,
  ) {}

  seal(plain: Buffer): Buffer {
    if (this.counter >= MAX_FRAMES_PER_KEY) throw new ChannelError('exhausted');
    const cipher = createCipheriv('aes-256-gcm', this.key, nonceFor(this.counter), { authTagLength: TAG_BYTES });
    cipher.setAAD(aadFor(this.direction, plain.length + TAG_BYTES, this.context));
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    this.counter++;
    return body;
  }

  open(body: Buffer): Buffer {
    if (body.length < TAG_BYTES) throw new ChannelError('short');
    if (this.counter >= MAX_FRAMES_PER_KEY) throw new ChannelError('exhausted');
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonceFor(this.counter), { authTagLength: TAG_BYTES });
    decipher.setAAD(aadFor(this.direction, body.length, this.context));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    try {
      const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
      this.counter++;
      return plain;
    } catch {
      throw new ChannelError('auth');
    }
  }
}

export const MEMBER_TO_HOST = 1;
export const HOST_TO_MEMBER = 2;

/** Both lanes of one connection, seen from one end. `sendKey` and `receiveKey` are the two 32-byte halves of the HKDF output. */
export class SecureChannel {
  private readonly out: Lane;
  private readonly inbound: Lane;

  constructor(sendKey: Buffer, receiveKey: Buffer, sending: 1 | 2, context: Uint8Array = Buffer.alloc(0)) {
    this.out = new Lane(sendKey, sending, context);
    this.inbound = new Lane(receiveKey, sending === MEMBER_TO_HOST ? HOST_TO_MEMBER : MEMBER_TO_HOST, context);
  }

  seal(plain: Buffer): Buffer {
    return this.out.seal(plain);
  }

  open(body: Buffer): Buffer {
    return this.inbound.open(body);
  }
}

/** The channel of a finished handshake from the 64 bytes of key material: member->host key first. */
export function channelFromKeys(material: Buffer, role: 'member' | 'host', context: Uint8Array): SecureChannel {
  const memberToHost = material.subarray(0, 32);
  const hostToMember = material.subarray(32, 64);
  return role === 'member'
    ? new SecureChannel(memberToHost, hostToMember, MEMBER_TO_HOST, context)
    : new SecureChannel(hostToMember, memberToHost, HOST_TO_MEMBER, context);
}

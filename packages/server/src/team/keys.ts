// Cryptographic primitives of the team protocol, all from node:crypto: X25519 key agreement, Ed25519 identities, HKDF,
// HMAC, scrypt and constant-time comparison. Nothing here touches the network or the disk.
import {
  type KeyObject,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  scrypt,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { SCRYPT_PARAMS } from './limits';

const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export const KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;

export class CryptoError extends Error {}

// ---- encodings -------------------------------------------------------------------------------------------------------

export const toB64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

/** Strict base64: refuses anything that does not round-trip, and a wrong length when one is given. */
export function fromB64(value: unknown, length?: number): Buffer {
  if (typeof value !== 'string' || value.length > 8192) throw new CryptoError('bad-base64');
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value) throw new CryptoError('bad-base64');
  if (length !== undefined && data.length !== length) throw new CryptoError('bad-length');
  return data;
}

// ---- digests ---------------------------------------------------------------------------------------------------------

export const sha256 = (...parts: Uint8Array[]): Buffer => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};

export const hmac = (key: Uint8Array, ...parts: Uint8Array[]): Buffer => {
  const mac = createHmac('sha256', key);
  for (const part of parts) mac.update(part);
  return mac.digest();
};

/** SHA-256 of a label and length-prefixed parts: two different part lists never give the same input. */
export function transcript(label: string, ...parts: Uint8Array[]): Buffer {
  const hash = createHash('sha256');
  const tag = Buffer.from(label, 'utf8');
  hash.update(Buffer.from([tag.length]));
  hash.update(tag);
  for (const part of parts) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(part.length);
    hash.update(length);
    hash.update(part);
  }
  return hash.digest();
}

export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/** The pairing code, stretched. The salt comes from the host and is public. */
export function stretchCode(code: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(code, 'utf8'), salt, KEY_BYTES, SCRYPT_PARAMS, (error, key) =>
      error === null ? resolve(key) : reject(error),
    );
  });
}

// ---- key agreement ---------------------------------------------------------------------------------------------------

export interface Ephemeral {
  publicRaw: Buffer;
  privateKey: KeyObject;
}

export function newEphemeral(): Ephemeral {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return { publicRaw: publicKey.export({ format: 'der', type: 'spki' }).subarray(-KEY_BYTES), privateKey };
}

/** X25519 shared secret; a weak peer key (all-zero result) is refused. */
export function agree(privateKey: KeyObject, peerRaw: Buffer): Buffer {
  if (peerRaw.length !== KEY_BYTES) throw new CryptoError('bad-key');
  const peer = createPublicKey({ key: Buffer.concat([X25519_SPKI, peerRaw]), format: 'der', type: 'spki' });
  const secret = diffieHellman({ privateKey, publicKey: peer });
  if (secret.every((byte) => byte === 0)) throw new CryptoError('weak-key');
  return secret;
}

// ---- identities ------------------------------------------------------------------------------------------------------

export interface Identity {
  publicRaw: Buffer;
  privateKey: KeyObject;
}

export interface StoredIdentity {
  pub: string;
  priv: string;
}

export function newIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicRaw: publicKey.export({ format: 'der', type: 'spki' }).subarray(-KEY_BYTES), privateKey };
}

export function exportIdentity(identity: Identity): StoredIdentity {
  return {
    pub: toB64(identity.publicRaw),
    priv: toB64(identity.privateKey.export({ format: 'der', type: 'pkcs8' })),
  };
}

/** Rebuilds an identity from the file; the public half must belong to the private one. */
export function importIdentity(stored: StoredIdentity): Identity {
  const privateKey = createPrivateKey({ key: fromB64(stored.priv), format: 'der', type: 'pkcs8' });
  const publicRaw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-KEY_BYTES);
  if (!safeEqual(publicRaw, fromB64(stored.pub, KEY_BYTES))) throw new CryptoError('identity-mismatch');
  return { publicRaw, privateKey };
}

export function edSign(identity: Identity, data: Uint8Array): Buffer {
  return sign(null, data, identity.privateKey);
}

export function edVerify(publicRaw: Buffer, data: Uint8Array, signature: Buffer): boolean {
  if (publicRaw.length !== KEY_BYTES || signature.length !== SIGNATURE_BYTES) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, publicRaw]), format: 'der', type: 'spki' });
    return verify(null, data, key, signature);
  } catch {
    return false;
  }
}

/** Short fingerprint of a public key for people to compare: `1a2b-3c4d-5e6f-7a8b`. */
export function fingerprint(publicRaw: Uint8Array): string {
  return (sha256(publicRaw).toString('hex').slice(0, 16).match(/.{4}/g) ?? []).join('-');
}

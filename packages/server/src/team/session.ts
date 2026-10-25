// Session handshake (a paired member connects again), a signed Diffie-Hellman exchange pinned to known keys:
//   M -> H  hello     memberId, eM, nM
//   H -> M  hello-ok  eH, nH, status, sig = Ed25519_host(tr)         (the member checks it against the pinned host key)
//   M -> H  auth      sig = Ed25519_member(tr)                        (the host checks it against the stored member key)
//   keys = HKDF(X25519(eM, eH), salt = H(tr), "session keys") -> member->host key || host->member key
// tr covers the version, both identity keys, both ephemeral keys, both nonces and the status, so a signature cannot be
// replayed in another session and neither side can be replaced by a man in the middle. The host's status (ok, revoked,
// unknown) is signed too, so "you were removed" cannot be forged. The host stores only public keys of its members.
import { randomBytes } from 'node:crypto';
import { TEAM_PROTOCOL_VERSION, isSafeKey } from '@ai-office/shared';
import type { FramedConn } from './conn';
import { type Identity, agree, edSign, edVerify, fromB64, hkdf, newEphemeral, toB64, transcript } from './keys';
import { HANDSHAKE_MAX_BYTES, HANDSHAKE_TIMEOUT_MS } from './limits';
import { channelFromKeys, type SecureChannel } from './secure-channel';
import { ProtocolError, decode, expect, sendPlain, type WireMessage } from './wire';

export type SessionStatus = 'ok' | 'revoked' | 'unknown';
const STATUS_BYTE: Record<SessionStatus, number> = { ok: 0, revoked: 1, unknown: 2 };
const ZERO_KEY = Buffer.alloc(32);

interface Parts {
  hostPub: Buffer;
  memberPub: Buffer;
  eMember: Buffer;
  nMember: Buffer;
  eHost: Buffer;
  nHost: Buffer;
  status: SessionStatus;
}

function trFor(label: string, p: Parts): Buffer {
  return transcript(
    label,
    Buffer.from([TEAM_PROTOCOL_VERSION, STATUS_BYTE[p.status]]),
    p.hostPub,
    p.memberPub,
    p.eMember,
    p.nMember,
    p.eHost,
    p.nHost,
  );
}

function checkVersion(message: WireMessage): void {
  if (message.v !== TEAM_PROTOCOL_VERSION) throw new ProtocolError('version-mismatch');
}

// ---- member side -------------------------------------------------------------------------------------------------------

export interface MemberCredentials {
  memberId: string;
  identity: Identity;
  hostPub: Buffer;
}

/** Connects with the stored credentials. Resolves with the channel and the host's first (encrypted) message. */
export async function memberSession(
  conn: FramedConn,
  creds: MemberCredentials,
): Promise<{ channel: SecureChannel; ready: Buffer }> {
  conn.setMaxBytes(HANDSHAKE_MAX_BYTES);
  const eMember = newEphemeral();
  const nMember = randomBytes(16);
  sendPlain(conn, {
    t: 'hello',
    v: TEAM_PROTOCOL_VERSION,
    member: creds.memberId,
    e: toB64(eMember.publicRaw),
    n: toB64(nMember),
  });

  const ack = expect(decode(await conn.read(HANDSHAKE_TIMEOUT_MS)), 'hello-ok');
  checkVersion(ack);
  const status = ack.status;
  if (status !== 'ok' && status !== 'revoked' && status !== 'unknown') throw new ProtocolError('protocol-error');
  const parts: Parts = {
    hostPub: creds.hostPub,
    memberPub: status === 'ok' ? creds.identity.publicRaw : ZERO_KEY,
    eMember: eMember.publicRaw,
    nMember,
    eHost: fromB64(ack.e, 32),
    nHost: fromB64(ack.n, 16),
    status,
  };
  if (!edVerify(creds.hostPub, trFor('ao-team/v1 host sig', parts), fromB64(ack.sig, 64)))
    throw new ProtocolError('host-key-changed');
  if (status === 'revoked') throw new ProtocolError('revoked');
  if (status === 'unknown') throw new ProtocolError('unknown-member');

  const tr = trFor('ao-team/v1 session', parts);
  sendPlain(conn, { t: 'auth', sig: toB64(edSign(creds.identity, trFor('ao-team/v1 member sig', parts))) });
  const material = hkdf(agree(eMember.privateKey, parts.eHost), tr, 'ao-team/v1 session keys', 64);
  const channel = channelFromKeys(material, 'member', tr);
  return { channel, ready: await conn.read(HANDSHAKE_TIMEOUT_MS) };
}

// ---- host side ---------------------------------------------------------------------------------------------------------

export interface HostSessionContext {
  identity: Identity;
  /** The stored public key of a member, or the reason it has none. */
  lookup(memberId: string): { pub: Buffer } | 'revoked' | 'unknown';
}

export interface HostSession {
  memberId: string;
  /** The public key the member proved at this handshake: the host re-checks it is still the member's. */
  memberPub: Buffer;
  channel: SecureChannel;
}

/**
 * Answers one hello. Resolves with the authenticated session; `refused` when a signed refusal (removed, unknown) was
 * sent; `bad-signature` when the member could not prove its key (the caller counts those). Throws ProtocolError for a
 * malformed or foreign-version hello.
 */
export async function hostSession(
  conn: FramedConn,
  hello: WireMessage,
  ctx: HostSessionContext,
): Promise<HostSession | 'refused' | 'bad-signature'> {
  checkVersion(hello);
  const memberId = hello.member;
  if (!isSafeKey(memberId, 8, 32)) throw new ProtocolError('protocol-error');
  const eMember = fromB64(hello.e, 32);
  const nMember = fromB64(hello.n, 16);
  const found = ctx.lookup(memberId);
  const status: SessionStatus = found === 'revoked' ? 'revoked' : found === 'unknown' ? 'unknown' : 'ok';
  const eHost = newEphemeral();
  const parts: Parts = {
    hostPub: ctx.identity.publicRaw,
    memberPub: typeof found === 'string' ? ZERO_KEY : found.pub,
    eMember,
    nMember,
    eHost: eHost.publicRaw,
    nHost: randomBytes(16),
    status,
  };
  sendPlain(conn, {
    t: 'hello-ok',
    v: TEAM_PROTOCOL_VERSION,
    e: toB64(parts.eHost),
    n: toB64(parts.nHost),
    status,
    sig: toB64(edSign(ctx.identity, trFor('ao-team/v1 host sig', parts))),
  });
  if (typeof found === 'string') {
    conn.close();
    return 'refused';
  }
  const auth = expect(decode(await conn.read(HANDSHAKE_TIMEOUT_MS)), 'auth');
  if (!edVerify(found.pub, trFor('ao-team/v1 member sig', parts), fromB64(auth.sig, 64))) {
    conn.destroy();
    return 'bad-signature';
  }
  const tr = trFor('ao-team/v1 session', parts);
  const material = hkdf(agree(eHost.privateKey, eMember), tr, 'ao-team/v1 session keys', 64);
  return { memberId, memberPub: found.pub, channel: channelFromKeys(material, 'host', tr) };
}

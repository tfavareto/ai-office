// Pairing handshake (a new device joins a team with the code). Both sides prove they know the code without sending it:
//   M -> H  pair-hello      eM
//   H -> M  pair-challenge  eH, nH, salt
//   M -> H  pair-proof      proofM = HMAC(kMac, "member" || tr || H(box)), box = AEAD(name, device, member public key)
//   H -> M  pair-accept     proofH = HMAC(kMac, "host" || tr || proofM || H(box')), box' = AEAD(memberId, team, host key)
// tr = H(eM, eH, nH, salt); kMac derives from scrypt(code, salt); the box keys derive from X25519(eM, eH) and the code key.
// The host answers a wrong proof with one generic error and counts it; after 5 the code is destroyed. The host reveals
// nothing keyed by the code before the member proved it, so connecting without the code yields nothing to test guesses on.
import { randomBytes } from 'node:crypto';
import { TEAM_DEVICE_MAX, TEAM_NAME_MAX, TEAM_PROTOCOL_VERSION, TEAM_TEAMNAME_MAX, cleanLine } from '@ai-office/shared';
import type { FramedConn } from './conn';
import {
  type Identity,
  agree,
  fromB64,
  hkdf,
  hmac,
  newEphemeral,
  safeEqual,
  sha256,
  stretchCode,
  toB64,
  transcript,
} from './keys';
import { HANDSHAKE_MAX_BYTES, HANDSHAKE_TIMEOUT_MS } from './limits';
import type { PairingGate, PairingTicket } from './pairing';
import { channelFromKeys, type SecureChannel } from './secure-channel';
import { ProtocolError, decode, encode, expect, sendPlain, type WireMessage } from './wire';

const MAC_INFO = 'ao-team/v1 pair mac';
const KEYS_INFO = 'ao-team/v1 pair keys';

interface PairKeys {
  kMac: Buffer;
  tr: Buffer;
  channel: (role: 'member' | 'host') => SecureChannel;
}

function pairKeys(
  codeKey: Buffer,
  salt: Buffer,
  eMember: Buffer,
  eHost: Buffer,
  nonce: Buffer,
  shared: Buffer,
): PairKeys {
  const tr = transcript('ao-team/v1 pair', eMember, eHost, nonce, salt);
  const kMac = hkdf(codeKey, salt, MAC_INFO, 32);
  const material = hkdf(Buffer.concat([shared, codeKey]), tr, KEYS_INFO, 64);
  return { kMac, tr, channel: (role) => channelFromKeys(material, role, tr) };
}

const memberProof = (keys: PairKeys, box: Buffer): Buffer =>
  hmac(keys.kMac, Buffer.from('member'), keys.tr, sha256(box));
const hostProof = (keys: PairKeys, proofM: Buffer, box: Buffer): Buffer =>
  hmac(keys.kMac, Buffer.from('host'), keys.tr, proofM, sha256(box));

function checkVersion(message: WireMessage): void {
  if (message.v !== TEAM_PROTOCOL_VERSION) throw new ProtocolError('version-mismatch');
}

function json(buffer: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(buffer.toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // falls through
  }
  throw new ProtocolError('protocol-error');
}

// ---- member side -------------------------------------------------------------------------------------------------------

export interface PairInput {
  code: string;
  name: string;
  device: string;
  identity: Identity;
  /** Replaces the scrypt stretching (tests only). */
  stretch?: (code: string, salt: Buffer) => Promise<Buffer>;
}

export interface Paired {
  memberId: string;
  teamId: string;
  teamName: string;
  hostName: string;
  hostPub: Buffer;
}

export async function memberPair(conn: FramedConn, input: PairInput): Promise<Paired> {
  conn.setMaxBytes(HANDSHAKE_MAX_BYTES);
  const eMember = newEphemeral();
  sendPlain(conn, { t: 'pair-hello', v: TEAM_PROTOCOL_VERSION, e: toB64(eMember.publicRaw) });

  const challenge = expect(decode(await conn.read(HANDSHAKE_TIMEOUT_MS)), 'pair-challenge');
  checkVersion(challenge);
  const eHost = fromB64(challenge.e, 32);
  const nonce = fromB64(challenge.n, 16);
  const salt = fromB64(challenge.salt, 16);
  const codeKey = await (input.stretch ?? stretchCode)(input.code, salt);
  const keys = pairKeys(codeKey, salt, eMember.publicRaw, eHost, nonce, agree(eMember.privateKey, eHost));

  const channel = keys.channel('member');
  const box = channel.seal(encode({ name: input.name, device: input.device, pub: toB64(input.identity.publicRaw) }));
  const proofM = memberProof(keys, box);
  sendPlain(conn, { t: 'pair-proof', proof: toB64(proofM), box: toB64(box) });

  const accept = expect(decode(await conn.read(HANDSHAKE_TIMEOUT_MS)), 'pair-accept');
  const boxH = fromB64(accept.box);
  if (!safeEqual(fromB64(accept.proof, 32), hostProof(keys, proofM, boxH))) throw new ProtocolError('pairing-failed');
  const body = json(channel.open(boxH));
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  const teamId = typeof body.teamId === 'string' ? body.teamId : '';
  const teamName = cleanLine(body.teamName, TEAM_TEAMNAME_MAX);
  const hostName = cleanLine(body.hostName, TEAM_NAME_MAX);
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(memberId) || !/^[A-Za-z0-9_-]{8,32}$/.test(teamId))
    throw new ProtocolError('protocol-error');
  if (teamName === undefined || hostName === undefined) throw new ProtocolError('protocol-error');
  return { memberId, teamId, teamName, hostName, hostPub: fromB64(body.hostPub, 32) };
}

// ---- host side ---------------------------------------------------------------------------------------------------------

export interface NewMember {
  name: string;
  device: string;
  pub: Buffer;
}

export interface HostPairContext {
  gate: PairingGate;
  identity: Identity;
  teamId: string;
  teamName: string;
  hostName: string;
  /** Stores the member (and the file) and returns its id; undefined when the team is full. */
  addMember(member: NewMember): Promise<string | undefined>;
  /** A wrong proof came from this connection (for the per-address limit). */
  onWrongProof(): void;
}

/** Answers one pairing attempt. Resolves when the attempt is over; it never throws: every outcome is a message. */
export async function hostPair(conn: FramedConn, hello: WireMessage, ctx: HostPairContext): Promise<void> {
  const refuse = (code: string): void => {
    sendPlain(conn, { t: 'error', code });
    conn.close();
  };
  try {
    checkVersion(hello);
    const eMember = fromB64(hello.e, 32);
    const ticket = ctx.gate.ticket();
    if (typeof ticket === 'string') return refuse(ticket);

    const eHost = newEphemeral();
    const nonce = randomBytes(16);
    sendPlain(conn, {
      t: 'pair-challenge',
      v: TEAM_PROTOCOL_VERSION,
      e: toB64(eHost.publicRaw),
      n: toB64(nonce),
      salt: toB64(ticket.salt),
    });

    const proof = expect(decode(await conn.read(HANDSHAKE_TIMEOUT_MS)), 'pair-proof');
    const box = fromB64(proof.box);
    const keys = pairKeys(ticket.key, ticket.salt, eMember, eHost.publicRaw, nonce, agree(eHost.privateKey, eMember));
    const proofM = fromB64(proof.proof, 32);
    if (!safeEqual(proofM, memberProof(keys, box))) return wrongProof(ticket, ctx, refuse);
    // From here the proof is right: the first connection to get here uses the code up.
    if (!ctx.gate.consume(ticket)) return refuse('not-pairing');

    const channel = keys.channel('host');
    const body = json(channel.open(box));
    const name = cleanLine(body.name, TEAM_NAME_MAX);
    const device = cleanLine(body.device, TEAM_DEVICE_MAX) ?? '';
    const pub = fromB64(body.pub, 32);
    if (name === undefined) return refuse('protocol-error');
    const memberId = await ctx.addMember({ name, device, pub });
    if (memberId === undefined) return refuse('team-full');

    const boxH = channel.seal(
      encode({
        memberId,
        teamId: ctx.teamId,
        teamName: ctx.teamName,
        hostName: ctx.hostName,
        hostPub: toB64(ctx.identity.publicRaw),
      }),
    );
    sendPlain(conn, { t: 'pair-accept', proof: toB64(hostProof(keys, proofM, boxH)), box: toB64(boxH) });
    conn.close();
  } catch (error) {
    refuse(error instanceof ProtocolError ? error.code : 'protocol-error');
  }
}

function wrongProof(ticket: PairingTicket, ctx: HostPairContext, refuse: (code: string) => void): void {
  ctx.onWrongProof();
  ctx.gate.fail(ticket);
  // One generic answer for every failure, so the reply says nothing about what was wrong.
  refuse('pairing-failed');
}

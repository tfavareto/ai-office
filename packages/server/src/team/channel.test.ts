import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { FrameError } from './conn';
import { CryptoError, hkdf, exportIdentity, fingerprint, fromB64, importIdentity, newIdentity, toB64 } from './keys';
import { ChannelError, channelFromKeys } from './secure-channel';
import { type Pair, connectedPair } from './testkit';

function channels(): { member: ReturnType<typeof channelFromKeys>; host: ReturnType<typeof channelFromKeys> } {
  const material = randomBytes(64);
  const context = Buffer.from('transcript');
  return { member: channelFromKeys(material, 'member', context), host: channelFromKeys(material, 'host', context) };
}

describe('secure channel', () => {
  test('round-trips messages in order in both directions', () => {
    const { member, host } = channels();

    const first = member.seal(Buffer.from('one'));
    const second = member.seal(Buffer.from('two'));

    expect(host.open(first).toString()).toBe('one');
    expect(host.open(second).toString()).toBe('two');
    expect(member.open(host.seal(Buffer.from('back'))).toString()).toBe('back');
  });

  test('a replayed frame is rejected', () => {
    const { member, host } = channels();
    const frame = member.seal(Buffer.from('once'));
    host.open(frame);

    expect(() => host.open(frame)).toThrow(ChannelError);
  });

  test('a tampered frame is rejected, whatever byte changes', () => {
    const { member, host } = channels();
    const frame = member.seal(Buffer.from('payload that matters'));
    for (let i = 0; i < frame.length; i++) {
      const tampered = Buffer.from(frame);
      tampered[i] = (tampered[i] ?? 0) ^ 0x01;
      expect(() => host.open(tampered), `byte ${i}`).toThrow(ChannelError);
    }
    expect(host.open(frame).toString()).toBe('payload that matters');
  });

  test('frames delivered out of order, or dropped, are rejected', () => {
    const { member, host } = channels();
    const a = member.seal(Buffer.from('a'));
    const b = member.seal(Buffer.from('b'));

    expect(() => host.open(b)).toThrow(ChannelError);
    expect(host.open(a).toString()).toBe('a');
  });

  test('a frame reflected back to its sender is rejected (the directions use different keys)', () => {
    const { member } = channels();
    const frame = member.seal(Buffer.from('mine'));

    expect(() => member.open(frame)).toThrow(ChannelError);
  });

  test('a frame from another session is rejected', () => {
    const one = channels();
    const two = channels();

    expect(() => two.host.open(one.member.seal(Buffer.from('x')))).toThrow(ChannelError);
  });

  test('a truncated frame is rejected', () => {
    const { host } = channels();
    expect(() => host.open(Buffer.alloc(3))).toThrow(ChannelError);
  });

  test('each message has a different ciphertext even for the same plaintext (counters never repeat)', () => {
    const { member } = channels();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(member.seal(Buffer.from('same')).toString('hex'));
    expect(seen.size).toBe(200);
  });
});

describe('keys', () => {
  test('an identity survives export and import, and a mismatching pair is refused', () => {
    const identity = newIdentity();
    const stored = exportIdentity(identity);

    expect(importIdentity(stored).publicRaw.equals(identity.publicRaw)).toBe(true);
    expect(() => importIdentity({ ...stored, pub: exportIdentity(newIdentity()).pub })).toThrow(CryptoError);
  });

  test('strict base64 refuses non-canonical input and wrong lengths', () => {
    expect(() => fromB64('AAA')).toThrow(CryptoError);
    expect(() => fromB64(toB64(Buffer.alloc(5)), 32)).toThrow(CryptoError);
    expect(() => fromB64(12)).toThrow(CryptoError);
  });

  test('fingerprints are short and stable', () => {
    const key = newIdentity().publicRaw;
    expect(fingerprint(key)).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
    expect(fingerprint(key)).toBe(fingerprint(key));
  });
});

describe('framed connection', () => {
  const open: Pair[] = [];
  afterEach(async () => {
    for (const pair of open.splice(0)) await pair.close();
  });

  test('an HTTP request sent to the team port is dropped without any reply', async () => {
    const pair = await connectedPair();
    open.push(pair);
    const received: Buffer[] = [];
    pair.rawClient.on('data', (data: Buffer) => received.push(data));

    pair.rawClient.write('GET /api/health HTTP/1.1\r\nHost: x\r\n\r\n');

    await expect(pair.server.read(1000)).rejects.toMatchObject({ code: 'too-large' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Buffer.concat(received).length).toBe(0);
  });

  test('a frame over the limit closes the connection, and a zero-length frame too', async () => {
    const pair = await connectedPair(100);
    open.push(pair);
    pair.client.send(Buffer.alloc(101));

    await expect(pair.server.read(1000)).rejects.toBeInstanceOf(FrameError);
  });

  test('frames sent back to back arrive whole and in order, even when split across packets', async () => {
    const pair = await connectedPair();
    open.push(pair);
    const wire = Buffer.concat(
      ['alpha', 'beta'].map((text) => Buffer.concat([Buffer.from([0, 0, 0, text.length]), Buffer.from(text)])),
    );

    pair.rawClient.write(wire.subarray(0, 3));
    pair.rawClient.write(wire.subarray(3, 9));
    pair.rawClient.write(wire.subarray(9));

    expect((await pair.server.read(1000)).toString()).toBe('alpha');
    expect((await pair.server.read(1000)).toString()).toBe('beta');
  });

  test('a frame of exactly the limit is accepted, one byte more is not', async () => {
    const pair = await connectedPair(64);
    open.push(pair);

    pair.client.send(Buffer.alloc(64, 1));
    expect((await pair.server.read(1000)).length).toBe(64);
    pair.client.send(Buffer.alloc(65, 1));

    await expect(pair.server.read(1000)).rejects.toMatchObject({ code: 'too-large' });
  });

  test('a header that trickles in one byte at a time still makes one whole frame', async () => {
    const pair = await connectedPair();
    open.push(pair);
    const wire = Buffer.concat([Buffer.from([0, 0, 0, 5]), Buffer.from('hello')]);

    for (const byte of wire) {
      pair.rawClient.write(Buffer.from([byte]));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect((await pair.server.read(1000)).toString()).toBe('hello');
  });

  test('a flood of frames nobody reads ends the connection instead of growing memory', async () => {
    const pair = await connectedPair();
    open.push(pair);
    const one = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from('x')]);

    pair.rawClient.write(Buffer.concat(Array.from({ length: 300 }, () => one)));
    await new Promise((resolve) => setTimeout(resolve, 100));

    let read = 0;
    let code: string;
    for (;;) {
      try {
        await pair.server.read(200);
        read++;
      } catch (error) {
        code = (error as { code: string }).code;
        break;
      }
    }
    expect(code).toBe('flood');
    expect(read).toBeLessThanOrEqual(64);
  });

  test('a silent peer times out', async () => {
    const pair = await connectedPair();
    open.push(pair);

    await expect(pair.server.read(50)).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('key separation', () => {
  test("the same secret gives different keys for pairing and for sessions, and neither opens the other's frames", () => {
    const secret = randomBytes(32);
    const salt = randomBytes(32);
    const pairing = hkdf(secret, salt, 'ao-team/v1 pair keys', 64);
    const session = hkdf(secret, salt, 'ao-team/v1 session keys', 64);
    const context = Buffer.from('tr');

    const pairFrame = channelFromKeys(pairing, 'member', context).seal(Buffer.from('pair'));
    const sessionHost = channelFromKeys(session, 'host', context);

    expect(pairing.equals(session)).toBe(false);
    expect(() => sessionHost.open(pairFrame)).toThrow(ChannelError);
  });

  test('two sessions of the same pair of keys never share keys: a frame of one does not open in the other', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const salt = randomBytes(32);
    const keysA = hkdf(a, salt, 'ao-team/v1 session keys', 64);
    const keysB = hkdf(b, salt, 'ao-team/v1 session keys', 64);

    const frame = channelFromKeys(keysA, 'member', salt).seal(Buffer.from('x'));

    expect(keysA.equals(keysB)).toBe(false);
    expect(() => channelFromKeys(keysB, 'host', salt).open(frame)).toThrow(ChannelError);
    expect(channelFromKeys(keysA, 'host', salt).open(frame).toString()).toBe('x');
  });
});

// Local authentication: a random token stored in <stateDir>/token (mode 0600) that every non-public /api route needs.
// Hooks send `Authorization: Bearer <token>`; the page gets an HttpOnly, SameSite=Strict cookie when it loads.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { AUTH_COOKIE, HEALTH_PROOF_PREFIX, TOKEN_FILE_NAME } from '@ai-office/shared';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const MAX_NONCE_LENGTH = 128;
const NONCE_PATTERN = /^[A-Za-z0-9_-]+$/;
const STATE_DIR_MODE = 0o700;
const TOKEN_FILE_MODE = 0o600;

/** Creates the state dir (0700) and returns the existing token, or writes a fresh one (0600). */
export async function loadOrCreateToken(stateDir: string): Promise<string> {
  await mkdir(stateDir, { recursive: true, mode: STATE_DIR_MODE });
  await chmod(stateDir, STATE_DIR_MODE).catch(() => undefined);
  const path = join(stateDir, TOKEN_FILE_NAME);
  const existing = await readFile(path, 'utf8').then(
    (text) => text.trim(),
    () => undefined,
  );
  if (existing !== undefined && TOKEN_PATTERN.test(existing)) {
    await chmod(path, TOKEN_FILE_MODE).catch(() => undefined);
    return existing;
  }
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${token}\n`, { encoding: 'utf8', mode: TOKEN_FILE_MODE });
  await rename(temp, path);
  return token;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1];
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Holds the token (loaded at startup) and checks requests against it. Fails closed until `load` ran. */
export class TokenAuth {
  private token: string | undefined;
  private tokenDigest: Buffer | undefined;

  async load(stateDir: string): Promise<void> {
    this.use(await loadOrCreateToken(stateDir));
  }

  /** Uses a given token (tests, or after `load`). */
  use(token: string): void {
    this.token = token;
    this.tokenDigest = digest(token);
  }

  /** The token, for tests and for the cookie. Throws before the token is loaded. */
  get value(): string {
    if (this.token === undefined) throw new Error('Token não carregado');
    return this.token;
  }

  matches(candidate: string | undefined): boolean {
    if (candidate === undefined || candidate === '' || this.tokenDigest === undefined) return false;
    return timingSafeEqual(digest(candidate), this.tokenDigest);
  }

  /** True when the request carries the token as a Bearer header or as the session cookie. */
  authorize(req: IncomingMessage): boolean {
    return (
      this.matches(bearerToken(req.headers.authorization)) || this.matches(cookieValue(req.headers.cookie, AUTH_COOKIE))
    );
  }

  /** `Set-Cookie` value for the page. Not `Secure`: the server speaks plain HTTP on loopback. */
  cookie(): string {
    return `${AUTH_COOKIE}=${this.value}; Path=/; HttpOnly; SameSite=Strict`;
  }

  /** Proof that this server knows the token, for a hook-chosen nonce (so the hook can check it before sending the token). */
  proof(nonce: string | null): string | undefined {
    if (
      this.token === undefined ||
      nonce === null ||
      nonce.length === 0 ||
      nonce.length > MAX_NONCE_LENGTH ||
      !NONCE_PATTERN.test(nonce)
    )
      return undefined;
    return createHmac('sha256', this.token)
      .update(HEALTH_PROOF_PREFIX + nonce)
      .digest('hex');
  }
}

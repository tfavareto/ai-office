import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ai-office');
export const HOOKS_DIR = join(PLUGIN_DIR, 'hooks');
export const REPO_ROOT = join(PLUGIN_DIR, '..', '..', '..');

/** Token the fake office and the hooks share by default. */
export const TEST_TOKEN = 'ab'.repeat(32);
const HEALTH_PROOF_PREFIX = 'ai-office/health/v1:';

/** State dir (AI_OFFICE_STATE_DIR) holding `token`, removed when the test process exits. */
export function makeStateDir(token: string | null = TEST_TOKEN): string {
  const dir = mkdtempSync(join(tmpdir(), 'ai-office-hooks-'));
  if (token !== null) writeFileSync(join(dir, 'token'), `${token}\n`, { mode: 0o600 });
  stateDirs.push(dir);
  return dir;
}

const stateDirs: string[] = [];
process.on('exit', () => {
  for (const dir of stateDirs) rmSync(dir, { recursive: true, force: true });
});

const DEFAULT_STATE_DIR = makeStateDir();

export interface RecordedRequest {
  method: string;
  headers: IncomingHttpHeaders;
  path: string;
  query: URLSearchParams;
  body: unknown;
  bodyBytes: number;
}

export type RouteHandler = (request: RecordedRequest, res: ServerResponse) => void | Promise<void>;

export interface FakeOfficeOptions {
  /** Token the fake server knows (default TEST_TOKEN). */
  token?: string;
  /** Answer the identity challenge on /api/health like the real server (default true). */
  proveIdentity?: boolean;
  /** Require `Authorization: Bearer <token>` on every other route (default true). */
  requireAuth?: boolean;
}

/**
 * Tiny in-process HTTP server standing in for the AI Office server. Routes are `"METHOD /path"` keys. Like the real
 * one it answers the health challenge and rejects requests without the bearer token with 401. Health checks are not
 * recorded in `requests`; they go to `challenges`.
 */
export class FakeOffice {
  readonly requests: RecordedRequest[] = [];
  readonly challenges: string[] = [];
  private readonly options: Required<FakeOfficeOptions>;
  constructor(options: FakeOfficeOptions = {}) {
    this.options = { token: TEST_TOKEN, proveIdentity: true, requireAuth: true, ...options };
  }

  private readonly routes = new Map<string, RouteHandler>();
  private server: Server = createServer((req, res) => void this.handle(req, res));
  port = 0;

  on(route: string, handler: RouteHandler): this {
    this.routes.set(route, handler);
    return this;
  }

  /** Route that answers with a fixed status and JSON body. */
  json(route: string, body: unknown, status = 200): this {
    return this.on(route, (_request, res) => sendJson(res, body, status));
  }

  requestsTo(route: string): RecordedRequest[] {
    const [method, path] = route.split(' ');
    return this.requests.filter((request) => request.method === method && request.path === path);
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/health') {
      const nonce = url.searchParams.get('challenge');
      if (nonce !== null) this.challenges.push(nonce);
      const proof =
        nonce !== null && this.options.proveIdentity
          ? createHmac('sha256', this.options.token)
              .update(HEALTH_PROOF_PREFIX + nonce)
              .digest('hex')
          : undefined;
      return sendJson(res, { ok: true, ...(proof !== undefined ? { proof } : {}) });
    }
    const recorded: RecordedRequest = {
      headers: req.headers,
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined,
      bodyBytes: raw.length,
    };
    this.requests.push(recorded);
    if (this.options.requireAuth && req.headers.authorization !== `Bearer ${this.options.token}`)
      return sendJson(res, { error: 'unauthorized' }, 401);
    const handler = this.routes.get(`${recorded.method} ${recorded.path}`);
    if (!handler) return sendJson(res, { error: 'not found' }, 404);
    await handler(recorded, res);
  }
}

export function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** A port on which nothing listens. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface HookRun {
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  /** Parsed stdout, or undefined when it was empty. */
  output: any;
}

/** Runs a hook script as a real child process (async, so the in-process fake server keeps serving). */
export function runHookProcess(
  script: 'permission' | 'messages' | 'notify',
  input: unknown,
  env: Record<string, string>,
  rawStdin?: string,
): Promise<HookRun> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HOOKS_DIR, `${script}.mjs`)], {
      env: { PATH: process.env.PATH ?? '', AI_OFFICE_STATE_DIR: DEFAULT_STATE_DIR, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        elapsedMs: Date.now() - started,
        output: stdout.trim() === '' ? undefined : JSON.parse(stdout),
      });
    });
    child.stdin.end(rawStdin ?? JSON.stringify(input));
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

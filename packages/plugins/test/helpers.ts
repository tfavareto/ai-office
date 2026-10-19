import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ai-office');
export const HOOKS_DIR = join(PLUGIN_DIR, 'hooks');
export const REPO_ROOT = join(PLUGIN_DIR, '..', '..', '..');

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  bodyBytes: number;
}

export type RouteHandler = (request: RecordedRequest, res: ServerResponse) => void | Promise<void>;

/** Tiny in-process HTTP server standing in for the AI Office server. Routes are `"METHOD /path"` keys. */
export class FakeOffice {
  readonly requests: RecordedRequest[] = [];
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
    const recorded: RecordedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined,
      bodyBytes: raw.length,
    };
    this.requests.push(recorded);
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
      env: { PATH: process.env.PATH ?? '', ...env },
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

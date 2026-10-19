// Response helpers and JSON body reading with a size limit.
import type { IncomingMessage, ServerResponse } from 'node:http';

export const BODY_LIMIT_BYTES = 256 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error });
}

/** Reads and parses a JSON body. Throws HttpError 413 (too large) or 400 (invalid JSON). */
export async function readJsonBody(req: IncomingMessage, limit = BODY_LIMIT_BYTES): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'body-too-large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'body-too-large');
    chunks.push(buffer);
  }
  if (size === 0) throw new HttpError(400, 'empty-body');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid-json');
  }
}

/** AbortSignal that fires when the client goes away (used by long-polls). */
export function closeSignal(req: IncomingMessage, res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  req.on('aborted', () => controller.abort());
  return controller.signal;
}

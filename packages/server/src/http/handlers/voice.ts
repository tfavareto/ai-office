// Local voice input (local access only): the status of the Whisper models, their one-time download, their removal and the
// files of a downloaded model, which the page loads into its own worker. Audio never reaches the server.
import { extname } from 'node:path';
import { API, isVoiceModelSize, parseVoiceModelId } from '@ai-office/shared';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { streamFile } from '../file-stream';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { RequestContext, Router } from '../router';

const MODEL_ROUTE = `${API.voice}/model`;

/** A single `bytes=start-end` range (the page asks for the first byte to learn a file's size). */
function parseRange(
  header: string | undefined,
  bytes: number,
): { start: number; end: number } | 'unsatisfiable' | undefined {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
  if (match === null) return undefined;
  const start = Number(match[1]);
  const end = match[2] === '' ? bytes - 1 : Math.min(Number(match[2]), bytes - 1);
  return start >= bytes || end < start ? 'unsatisfiable' : { start, end };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
};

export function registerVoiceRoutes(router: Router, app: AppContext): void {
  const store = app.voice;

  router.add('GET', `${API.voice}/status`, async ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, await store.status());
  });

  router.add('POST', `${API.voice}/download`, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const size = asRecord(await readJsonBody(req)).size;
    if (!isVoiceModelSize(size)) throw new HttpError(400, 'invalid-size');
    const result = store.start(size);
    if (result === 'disabled') return sendError(res, 409, 'voice-disabled');
    if (result === 'busy') return sendError(res, 409, 'voice-busy');
    sendJson(res, 202, await store.status());
  });

  router.add('DELETE', `${MODEL_ROUTE}/:id`, async ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const size = parseVoiceModelId(params.id ?? '');
    if (size === undefined) return sendError(res, 404, 'model-not-found');
    await store.remove(size);
    sendJson(res, 200, await store.status());
  });

  const serve = async ({ req, res, params, local }: RequestContext): Promise<void> => {
    if (!local) return sendError(res, 403, 'local-only');
    const size = parseVoiceModelId(params.id ?? '');
    // Only the exact paths listed for the model exist; anything else, `..` included, is simply not found.
    const path = params.dir === undefined ? params.file : `${params.dir}/${params.file}`;
    const file = size === undefined || path === undefined ? undefined : await store.file(size, path);
    if (file === undefined) return sendError(res, 404, 'not-found');
    const range = parseRange(req.headers.range, file.bytes);
    if (range === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${file.bytes}`, 'Cache-Control': 'no-store' });
      return void res.end();
    }
    const part = range ?? { start: 0, end: file.bytes - 1 };
    res.writeHead(range === undefined ? 200 : 206, {
      'Content-Type': CONTENT_TYPES[extname(file.path)] ?? 'application/octet-stream',
      'Content-Length': part.end - part.start + 1,
      ...(range === undefined ? {} : { 'Content-Range': `bytes ${part.start}-${part.end}/${file.bytes}` }),
      'Accept-Ranges': 'bytes',
      // The files are removable on request: the browser must not keep its own copy.
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return void res.end();
    streamFile(res, file.path, part);
  };
  for (const method of ['GET', 'HEAD']) {
    router.add(method, `${MODEL_ROUTE}/:id/:file`, serve);
    router.add(method, `${MODEL_ROUTE}/:id/:dir/:file`, serve);
  }
}

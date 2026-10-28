// A fake model hub for tests: a local HTTP server that serves synthetic files (with Range support), so no test ever
// reaches the real Hugging Face.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VOICE_MODEL_SIZES, voiceModelId, type VoiceModelSize } from '@ai-office/shared';
import type { VoiceModelSpec } from './manifest';
import type { VoiceSource } from './source';

export type HubHandler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

export interface FakeHub {
  origin: string;
  /** Requests received, in order: path and Range header. */
  requests: { path: string; range: string | undefined }[];
  /** Replaces the answer for one path (a redirect, a stall, a wrong length...). */
  override(path: string, handler: HubHandler): void;
  close(): Promise<void>;
}

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** The default answer: the whole file, or the part a `Range: bytes=N-` asks for. */
export function serveWithRange(req: IncomingMessage, res: ServerResponse, body: Buffer): void {
  const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
  if (range === null) {
    res.writeHead(200, { 'Content-Length': body.length, 'Accept-Ranges': 'bytes' });
    res.end(body);
    return;
  }
  const from = Number(range[1]);
  res.writeHead(206, {
    'Content-Length': body.length - from,
    'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`,
  });
  res.end(body.subarray(from));
}

/** Serves `files` under `/<repo>/resolve/<revision>/<path>`; `keys` are the full URL paths. */
export async function startFakeHub(files: ReadonlyMap<string, Buffer>): Promise<FakeHub> {
  const overrides = new Map<string, HubHandler>();
  const requests: FakeHub['requests'] = [];
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    requests.push({ path, range: req.headers.range });
    const body = files.get(path);
    const handler = overrides.get(path);
    if (handler !== undefined) return handler(req, res, body ?? Buffer.alloc(0));
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    serveWithRange(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    override: (path, handler) => void overrides.set(path, handler),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** A source that reads from the fake hub, and only from it. */
export function fakeSource(hub: FakeHub): VoiceSource {
  return {
    fileUrl: (spec, path) => new URL(`${hub.origin}/${spec.repo}/resolve/${spec.revision}/${path}`),
    allows: (url) => url.origin === hub.origin,
  };
}

export interface FakeModel {
  spec: VoiceModelSpec;
  /** URL path → content, for `startFakeHub`. */
  served: Map<string, Buffer>;
}

/** A tiny model: the same seven paths as a real one, a few hundred bytes each. */
export function fakeModel(repo: string, seed: string): FakeModel {
  const revision = sha256(`${repo}@${seed}`).slice(0, 40);
  const paths = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ];
  const served = new Map<string, Buffer>();
  const files = paths.map((path, i) => {
    const content = Buffer.from(`${seed}:${path}:`.repeat(40 + i * 10));
    served.set(`/${repo}/resolve/${revision}/${path}`, content);
    return { path, bytes: content.length, sha256: sha256(content) };
  });
  return { spec: { repo, revision, license: 'apache-2.0', files }, served };
}

export function fakeModels(): {
  specs: Record<VoiceModelSize, VoiceModelSpec>;
  served: Map<string, Buffer>;
} {
  const models = VOICE_MODEL_SIZES.map((size) => [size, fakeModel(`test/${voiceModelId(size)}`, size)] as const);
  return {
    specs: Object.fromEntries(models.map(([size, model]) => [size, model.spec])) as Record<
      VoiceModelSize,
      VoiceModelSpec
    >,
    served: new Map(models.flatMap(([, model]) => [...model.served])),
  };
}

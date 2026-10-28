// Downloads one model file: resumable, size-capped, with a connection and an idle timeout, redirects checked against the
// source's allowlist, and the SHA-256 verified before the file takes its final name.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, rename, rm } from 'node:fs/promises';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { VoiceDownloadErrorCode } from '@ai-office/shared';
import type { VoiceSource } from './source';

const FILE_MODE = 0o600;
const MAX_REDIRECTS = 5;
export const CONNECT_TIMEOUT_MS = 30_000;
export const IDLE_TIMEOUT_MS = 30_000;

/** A download that stopped for a reason the person can be told. */
export class VoiceDownloadFailure extends Error {
  constructor(
    readonly code: VoiceDownloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceDownloadFailure';
  }
}

export interface DownloadFileOptions {
  url: URL;
  source: VoiceSource;
  /** `<final path>.part`: kept when the transfer is cut, so the next attempt continues from it. */
  partPath: string;
  finalPath: string;
  bytes: number;
  sha256: string;
  fetchImpl: typeof fetch;
  /** Aborted when the download is cancelled or the server stops. */
  signal: AbortSignal;
  /** Bytes of this file that are on disk, called as they arrive. */
  onBytes: (bytes: number) => void;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

/**
 * Bytes of the partial file. Anything at that path that is not a plain file (a symbolic link, a folder) is removed
 * first, so the download never writes through a link into a file elsewhere.
 */
async function partialSize(path: string): Promise<number> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return 0;
  }
  if (info.isFile()) return info.size;
  await rm(path, { recursive: true, force: true });
  return 0;
}

/** Counts the bytes that pass, refuses more than `limit` and restarts an idle timer on every chunk. */
class Gauge extends Transform {
  received = 0;

  constructor(
    private readonly limit: number,
    private readonly onChunk: (received: number) => void,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.limit) {
      done(new VoiceDownloadFailure('size', 'O arquivo é maior do que o esperado'));
      return;
    }
    this.onChunk(this.received);
    done(null, chunk);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** Follows redirects by hand so every hop is checked against the allowlist. */
async function openResponse(options: DownloadFileOptions, resumeFrom: number, signal: AbortSignal): Promise<Response> {
  let url = options.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!options.source.allows(url))
      throw new VoiceDownloadFailure('network', `Endereço não permitido para o modelo: ${url.origin}`);
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity', 'User-Agent': 'ai-office' };
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
    const response = await options.fetchImpl(url, { headers, redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (location === null) throw new VoiceDownloadFailure('network', 'Redirecionamento sem destino');
      try {
        url = new URL(location, url);
      } catch {
        throw new VoiceDownloadFailure('network', 'Redirecionamento inválido');
      }
      continue;
    }
    return response;
  }
  throw new VoiceDownloadFailure('network', 'Redirecionamentos demais');
}

/** Checks the status line and length of the answer; resolves the offset the body continues from. */
function resumeOffset(response: Response, resumeFrom: number, bytes: number): number {
  const length = Number(response.headers.get('content-length'));
  const hasLength = response.headers.has('content-length') && Number.isFinite(length);
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '');
    if (range === null || Number(range[1]) !== resumeFrom || (range[3] !== '*' && Number(range[3]) !== bytes))
      throw new VoiceDownloadFailure('size', 'Resposta parcial inesperada');
    if (hasLength && length !== bytes - resumeFrom) throw new VoiceDownloadFailure('size', 'Tamanho inesperado');
    return resumeFrom;
  }
  if (response.status !== 200) throw new VoiceDownloadFailure('network', `O servidor respondeu ${response.status}`);
  if (hasLength && length !== bytes) throw new VoiceDownloadFailure('size', 'Tamanho inesperado');
  // The server ignored the range: start the file again.
  return 0;
}

async function sha256Of(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash, { signal });
  return hash.digest('hex');
}

/** Transfers the missing part of the file into `partPath`. Leaves the partial file in place when it fails midway. */
async function transfer(options: DownloadFileOptions, resumeFrom: number): Promise<void> {
  const idleMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const connectMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const stall = new AbortController();
  const signal = AbortSignal.any([options.signal, stall.signal]);
  let timer: NodeJS.Timeout | undefined;
  const arm = (ms: number, reason: string): void => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(new DOMException(reason, 'TimeoutError')), ms);
  };
  try {
    arm(connectMs, 'connect');
    const response = await openResponse(options, resumeFrom, signal);
    const offset = resumeOffset(response, resumeFrom, options.bytes);
    if (response.body === null) throw new VoiceDownloadFailure('network', 'Resposta sem conteúdo');
    options.onBytes(offset);
    const gauge = new Gauge(options.bytes - offset, (received) => {
      arm(idleMs, 'idle');
      options.onBytes(offset + received);
    });
    arm(idleMs, 'idle');
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      gauge,
      createWriteStream(options.partPath, { flags: offset > 0 ? 'a' : 'w', mode: FILE_MODE }),
      { signal },
    );
    if (offset + gauge.received !== options.bytes)
      throw new VoiceDownloadFailure('network', 'A transferência foi cortada');
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (error instanceof VoiceDownloadFailure) throw error;
    if (isAbort(error) || stall.signal.aborted) throw new VoiceDownloadFailure('timeout', 'A conexão ficou parada');
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOSPC' || code === 'EDQUOT') throw new VoiceDownloadFailure('disk', 'Sem espaço no disco');
    if (typeof code === 'string' && code.startsWith('E') && code !== 'ECONNRESET')
      throw new VoiceDownloadFailure('disk', `Não foi possível gravar o arquivo (${code})`);
    throw new VoiceDownloadFailure('network', 'Falha de rede ao baixar o modelo');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Brings one file to `finalPath`: continues a partial download when there is one, checks size and SHA-256, and only
 * then renames it. A file with the wrong hash is deleted, never kept.
 */
export async function downloadVerifiedFile(options: DownloadFileOptions): Promise<void> {
  let have = await partialSize(options.partPath);
  if (have > options.bytes) {
    await rm(options.partPath, { force: true });
    have = 0;
  }
  options.onBytes(have);
  if (have < options.bytes) await transfer(options, have);
  const actual = await sha256Of(options.partPath, options.signal);
  if (actual !== options.sha256) {
    await rm(options.partPath, { force: true });
    throw new VoiceDownloadFailure('integrity', 'O arquivo baixado não é o esperado (SHA-256 diferente)');
  }
  await chmod(options.partPath, FILE_MODE);
  await rename(options.partPath, options.finalPath);
}

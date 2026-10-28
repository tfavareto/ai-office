// The Whisper models on disk: `<state dir>/models/whisper-<size>/`, downloaded on request (never on their own), checked
// against the pinned SHA-256 of each file and served to the page from there. Folders are 0700, files 0600.
import { chmod, lstat, mkdir, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import {
  VOICE_MODEL_SIZES,
  voiceModelId,
  type VoiceDownloadErrorCode,
  type VoiceModelSize,
  type VoiceModelStatus,
  type VoiceStatusResponse,
} from '@ai-office/shared';
import type { Logger } from '../log';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';
import { downloadVerifiedFile, VoiceDownloadFailure } from './download-file';
import { VOICE_MODEL_SPECS, specBytes, type VoiceModelFile, type VoiceModelSpec } from './manifest';
import { HUGGING_FACE_SOURCE, type VoiceSource } from './source';

export const MODELS_DIR = 'models';
/** Written last, so a folder holds a usable model only when this file is there and describes the pinned files. */
export const MODEL_MARKER = 'model.json';
const MARKER_VERSION = 1;
const DIR_MODE = 0o700;
/** Room to spare on the disk besides the files themselves (the partial file and the hash pass need no more). */
const DISK_MARGIN = 1.1;
/** A whole model, however slow the connection: nothing legitimate takes longer. */
export const DOWNLOAD_DEADLINE_MS = 60 * 60_000;

export interface VoiceModelStoreOptions {
  stateDir: string;
  log: Logger;
  /** The environment turned voice input off (AI_OFFICE_VOICE=0): nothing is downloaded. */
  disabled?: boolean;
  /** Tests replace these; the real ones are Node's fetch, Hugging Face and the pinned list. */
  fetchImpl?: typeof fetch;
  source?: VoiceSource;
  specs?: Readonly<Record<VoiceModelSize, VoiceModelSpec>>;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  deadlineMs?: number;
  /** Free bytes on the disk that holds `dir`, or undefined when it cannot be told. */
  freeBytes?: (dir: string) => Promise<number | undefined>;
}

interface Job {
  size: VoiceModelSize;
  abort: AbortController;
  /** Bytes of the files already verified. */
  doneBytes: number;
  /** Bytes of the file being downloaded. */
  currentBytes: number;
  finished: Promise<void>;
}

async function defaultFreeBytes(dir: string): Promise<number | undefined> {
  try {
    const info = await statfs(dir);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return undefined;
  }
}

async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const info = await lstat(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

function markerMatches(raw: unknown, size: VoiceModelSize, spec: VoiceModelSpec): boolean {
  const marker = asRecord(raw);
  if (marker.version !== MARKER_VERSION || marker.size !== size || marker.revision !== spec.revision) return false;
  const files = Array.isArray(marker.files) ? marker.files.map(asRecord) : [];
  return (
    files.length === spec.files.length &&
    spec.files.every((file, i) => files[i]?.path === file.path && files[i]?.sha256 === file.sha256)
  );
}

export class VoiceModelStore {
  private readonly log: Logger;
  private readonly root: string;
  private readonly specs: Readonly<Record<VoiceModelSize, VoiceModelSpec>>;
  private readonly source: VoiceSource;
  private readonly jobs = new Map<VoiceModelSize, Job>();
  private readonly failures = new Map<VoiceModelSize, VoiceDownloadErrorCode>();

  constructor(private readonly options: VoiceModelStoreOptions) {
    this.log = options.log;
    this.root = join(options.stateDir, MODELS_DIR);
    this.specs = options.specs ?? VOICE_MODEL_SPECS;
    this.source = options.source ?? HUGGING_FACE_SOURCE;
  }

  get enabled(): boolean {
    return this.options.disabled !== true;
  }

  private dir(size: VoiceModelSize): string {
    return join(this.root, voiceModelId(size));
  }

  /** The model's files are all there and were verified when they were downloaded. */
  private async isReady(size: VoiceModelSize): Promise<boolean> {
    const spec = this.specs[size];
    if (!markerMatches(await readJsonFile(join(this.dir(size), MODEL_MARKER)), size, spec)) return false;
    for (const file of spec.files) {
      if ((await regularFileSize(join(this.dir(size), file.path))) !== file.bytes) return false;
    }
    return true;
  }

  private async modelStatus(size: VoiceModelSize): Promise<VoiceModelStatus> {
    const spec = this.specs[size];
    const bytes = specBytes(spec);
    const base = { size, id: voiceModelId(size), bytes };
    const job = this.jobs.get(size);
    if (job !== undefined)
      return { ...base, state: 'downloading', downloadedBytes: Math.min(bytes, job.doneBytes + job.currentBytes) };
    if (await this.isReady(size)) return { ...base, state: 'ready', downloadedBytes: bytes };
    const error = this.failures.get(size);
    return error === undefined
      ? { ...base, state: 'missing', downloadedBytes: 0 }
      : { ...base, state: 'error', downloadedBytes: 0, error };
  }

  async status(): Promise<VoiceStatusResponse> {
    const models = await Promise.all(VOICE_MODEL_SIZES.map((size) => this.modelStatus(size)));
    return { enabled: this.enabled, models };
  }

  /**
   * Starts the one-time download of a model (the person asked for it). One model downloads at a time; asking again for
   * the one that is downloading just joins it, and a model that is already there is left alone.
   */
  start(size: VoiceModelSize): 'started' | 'running' | 'busy' | 'disabled' {
    if (!this.enabled) return 'disabled';
    if (this.jobs.has(size)) return 'running';
    if (this.jobs.size > 0) return 'busy';
    this.failures.delete(size);
    const job: Job = { size, abort: new AbortController(), doneBytes: 0, currentBytes: 0, finished: Promise.resolve() };
    this.jobs.set(size, job);
    job.finished = this.run(job).finally(() => this.jobs.delete(size));
    return 'started';
  }

  /** Resolves when the download of `size` is over (tests, shutdown). */
  async settled(size: VoiceModelSize): Promise<void> {
    await this.jobs.get(size)?.finished;
  }

  private async run(job: Job): Promise<void> {
    const { size } = job;
    const spec = this.specs[size];
    const deadline = setTimeout(
      () => job.abort.abort(new DOMException('deadline', 'TimeoutError')),
      this.options.deadlineMs ?? DOWNLOAD_DEADLINE_MS,
    );
    try {
      if (await this.isReady(size)) return;
      await this.prepareDir(size, spec);
      this.log.info(`Baixando o modelo de voz ${voiceModelId(size)} (${Math.round(specBytes(spec) / 1e6)} MB)…`);
      for (const file of spec.files) await this.fetchFile(job, spec, file);
      await writeJsonAtomic(join(this.dir(size), MODEL_MARKER), {
        version: MARKER_VERSION,
        size,
        repo: spec.repo,
        revision: spec.revision,
        files: spec.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      });
      this.log.info(`Modelo de voz ${voiceModelId(size)} pronto.`);
    } catch (error) {
      const reason: unknown = job.abort.signal.aborted ? job.abort.signal.reason : undefined;
      const timedOut = reason instanceof DOMException && reason.name === 'TimeoutError';
      // Cancelled (the model was removed or the server is stopping): nothing to report.
      if (job.abort.signal.aborted && !timedOut) return;
      const code = timedOut ? 'timeout' : error instanceof VoiceDownloadFailure ? error.code : 'disk';
      this.failures.set(size, code);
      this.log.warn(`Não foi possível baixar o modelo de voz ${voiceModelId(size)} (${code}): ${String(error)}`);
    } finally {
      clearTimeout(deadline);
    }
  }

  /** Makes the folders (0700), drops files of another revision and checks there is room for the rest. */
  private async prepareDir(size: VoiceModelSize, spec: VoiceModelSpec): Promise<void> {
    const dir = this.dir(size);
    await mkdir(this.root, { recursive: true, mode: DIR_MODE });
    await chmod(this.root, DIR_MODE).catch(() => undefined);
    const marker = asRecord(await readJsonFile(join(dir, MODEL_MARKER)));
    // A leftover of another revision (an older release of AI Office): start clean.
    if (marker.revision !== undefined && marker.revision !== spec.revision)
      await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, 'onnx'), { recursive: true, mode: DIR_MODE });
    for (const folder of [dir, join(dir, 'onnx')]) await chmod(folder, DIR_MODE).catch(() => undefined);
    const free = await (this.options.freeBytes ?? defaultFreeBytes)(dir);
    if (free !== undefined && free < specBytes(spec) * DISK_MARGIN)
      throw new VoiceDownloadFailure('disk', 'Não há espaço livre suficiente no disco');
  }

  private async fetchFile(job: Job, spec: VoiceModelSpec, file: VoiceModelFile): Promise<void> {
    const finalPath = join(this.dir(job.size), file.path);
    job.currentBytes = 0;
    // A file under its final name was verified before it was renamed (an earlier run that was cut off).
    if ((await regularFileSize(finalPath)) === file.bytes) {
      job.doneBytes += file.bytes;
      return;
    }
    await downloadVerifiedFile({
      url: this.source.fileUrl(spec, file.path),
      source: this.source,
      partPath: `${finalPath}.part`,
      finalPath,
      bytes: file.bytes,
      sha256: file.sha256,
      fetchImpl: this.options.fetchImpl ?? fetch,
      signal: job.abort.signal,
      onBytes: (bytes) => {
        job.currentBytes = bytes;
      },
      ...(this.options.connectTimeoutMs !== undefined ? { connectTimeoutMs: this.options.connectTimeoutMs } : {}),
      ...(this.options.idleTimeoutMs !== undefined ? { idleTimeoutMs: this.options.idleTimeoutMs } : {}),
    });
    job.doneBytes += file.bytes;
    job.currentBytes = 0;
  }

  /** Stops the download of the model, if any, and deletes everything of it. */
  async remove(size: VoiceModelSize): Promise<void> {
    const job = this.jobs.get(size);
    if (job !== undefined) {
      job.abort.abort();
      await job.finished;
    }
    this.failures.delete(size);
    await rm(this.dir(size), { recursive: true, force: true });
  }

  /** The file of a ready model, if `path` is one of the files listed for it (nothing else is ever served). */
  async file(size: VoiceModelSize, path: string): Promise<{ path: string; bytes: number } | undefined> {
    const listed = this.specs[size].files.find((file) => file.path === path);
    if (listed === undefined || !(await this.isReady(size))) return undefined;
    return { path: join(this.dir(size), listed.path), bytes: listed.bytes };
  }

  /** Cancels what is downloading (the partial files stay, to continue next time). */
  async stop(): Promise<void> {
    const running = [...this.jobs.values()];
    for (const job of running) job.abort.abort();
    await Promise.all(running.map((job) => job.finished));
  }
}

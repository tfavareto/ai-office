// Persistence of the progress: <stateDir>/progress.json, mode 0600, written atomically (temp file + rename), versioned.
// A file that cannot be read is moved aside, never overwritten silently, and the office starts counting again.
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState, type ProgressState } from '@ai-office/shared';
import type { Logger } from '../log';
import { writeJsonAtomic } from '../util/fs-safe';
import { parseProgressFile } from './parse';

export const PROGRESS_FILE = 'progress.json';

export class ProgressStore {
  constructor(
    private readonly stateDir: string,
    private readonly log: Logger,
    private readonly now: () => number,
  ) {}

  private get path(): string {
    return join(this.stateDir, PROGRESS_FILE);
  }

  /** Never throws: a missing file is a new office, a bad one is kept aside and replaced by a new office. */
  async load(): Promise<ProgressState> {
    let content: string;
    try {
      content = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.log.warn(`Progresso: arquivo ilegível: ${String(error)}`);
      return emptyState();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(content) as unknown;
    } catch {
      raw = undefined;
    }
    const parsed = parseProgressFile(raw);
    if (parsed.status === 'ok') {
      if (parsed.dropped > 0) this.log.warn(`Progresso: ${parsed.dropped} registro(s) ilegível(is) foram descartados.`);
      return parsed.state;
    }
    await this.setAside();
    return emptyState();
  }

  /** Resolves false when the disk refused; the state in memory is kept and the next save tries again. */
  async save(state: ProgressState): Promise<boolean> {
    try {
      await writeJsonAtomic(this.path, state);
      return true;
    } catch (error) {
      this.log.warn(`Não foi possível salvar o progresso: ${String(error)}`);
      return false;
    }
  }

  private async setAside(): Promise<void> {
    const target = `${this.path}.unreadable-${this.now()}`;
    try {
      await rename(this.path, target);
      this.log.warn(`Progresso: o arquivo não pôde ser lido e foi guardado em ${PROGRESS_FILE}.unreadable-*.`);
    } catch (error) {
      this.log.warn(`Progresso: não foi possível guardar o arquivo ilegível: ${String(error)}`);
    }
  }
}

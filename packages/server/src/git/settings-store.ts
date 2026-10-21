// Settings of the git integration that the server must know: today only whether to ask `gh` for pull requests.
// Stored in <stateDir>/git-settings.json (mode 0600, atomic writes). Off until the person turns it on.
import { join } from 'node:path';
import type { Logger } from '../log';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';

export const GIT_SETTINGS_FILE = 'git-settings.json';
const VERSION = 1;

export class GitSettingsStore {
  private enabled = false;

  constructor(
    private readonly stateDir: string,
    private readonly log: Logger,
  ) {}

  get pullRequests(): boolean {
    return this.enabled;
  }

  /** Reads the file; a missing or unreadable one means the defaults (pull requests off). */
  async load(): Promise<void> {
    const stored = asRecord(await readJsonFile(join(this.stateDir, GIT_SETTINGS_FILE)));
    this.enabled = stored.version === VERSION && stored.pullRequests === true;
  }

  /** Stores the choice. Resolves false (and keeps the previous value) when the disk refused. */
  async setPullRequests(on: boolean): Promise<boolean> {
    try {
      await writeJsonAtomic(join(this.stateDir, GIT_SETTINGS_FILE), { version: VERSION, pullRequests: on });
    } catch (error) {
      this.log.warn(`Não foi possível salvar as configurações do Git: ${String(error)}`);
      return false;
    }
    this.enabled = on;
    return true;
  }
}

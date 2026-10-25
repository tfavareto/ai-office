// Whether the office reads Codex sessions at all. On unless the person turned it off in Settings (or the server was
// started with AI_OFFICE_CODEX=0). Stored in <stateDir>/codex-settings.json (mode 0600, atomic writes).
import { join } from 'node:path';
import type { Logger } from '../log';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';

export const CODEX_SETTINGS_FILE = 'codex-settings.json';
const VERSION = 1;

export class CodexSettingsStore {
  private enabled = true;

  constructor(
    private readonly stateDir: string,
    private readonly log: Logger,
    /** The environment turned Codex off: Settings cannot turn it back on. */
    private readonly forcedOff = false,
  ) {}

  /** The office reads Codex sessions. */
  get sessions(): boolean {
    return this.enabled && !this.forcedOff;
  }

  get locked(): boolean {
    return this.forcedOff;
  }

  /** Reads the file; a missing or unreadable one means the default (on). */
  async load(): Promise<void> {
    const stored = asRecord(await readJsonFile(join(this.stateDir, CODEX_SETTINGS_FILE)));
    this.enabled = stored.version !== VERSION || stored.sessions !== false;
  }

  /** Stores the choice. Resolves false (and keeps the previous value) when the disk refused. */
  async setSessions(on: boolean): Promise<boolean> {
    try {
      await writeJsonAtomic(join(this.stateDir, CODEX_SETTINGS_FILE), { version: VERSION, sessions: on });
    } catch (error) {
      this.log.warn(`Não foi possível salvar as configurações do Codex: ${String(error)}`);
      return false;
    }
    this.enabled = on;
    return true;
  }
}

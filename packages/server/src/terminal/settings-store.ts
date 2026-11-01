// Whether the office may open real terminals. Stored in <stateDir>/terminal-settings.json (mode 0600, atomic writes).
// Off until the person turns it on: it lets the page type into programs on this computer.
import { join } from 'node:path';
import type { Logger } from '../log';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';

export const TERMINAL_SETTINGS_FILE = 'terminal-settings.json';
const VERSION = 1;

export class TerminalSettingsStore {
  private on = false;

  constructor(
    private readonly stateDir: string,
    private readonly log: Logger,
  ) {}

  get enabled(): boolean {
    return this.on;
  }

  /** Reads the file; a missing or unreadable one means off. */
  async load(): Promise<void> {
    const stored = asRecord(await readJsonFile(join(this.stateDir, TERMINAL_SETTINGS_FILE)));
    this.on = stored.version === VERSION && stored.enabled === true;
  }

  /** Stores the choice. Resolves false (and keeps the previous value) when the disk refused. */
  async setEnabled(on: boolean): Promise<boolean> {
    try {
      await writeJsonAtomic(join(this.stateDir, TERMINAL_SETTINGS_FILE), { version: VERSION, enabled: on });
    } catch (error) {
      this.log.warn(`Não foi possível salvar as configurações dos terminais: ${String(error)}`);
      return false;
    }
    this.on = on;
    return true;
  }
}

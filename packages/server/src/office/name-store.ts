// Stable agent names, persisted in <stateDir>/names.json (key -> name).
import { join } from 'node:path';
import { type PersonName, findPerson, pickName } from '@ai-office/shared';
import type { Logger } from '../log';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';

const MAX_STORED = 3000;
const SAVE_DELAY_MS = 1500;

/** The name a person gave to an agent, by agent id (the customization). */
export type CustomNames = (agentId: string) => string | undefined;

export class NameStore {
  private readonly names = new Map<string, string>();
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly file: string | undefined,
    private readonly log: Logger,
    private readonly custom: CustomNames = () => undefined,
  ) {}

  static forStateDir(stateDir: string, log: Logger, custom?: CustomNames): NameStore {
    return new NameStore(join(stateDir, 'names.json'), log, custom);
  }

  /** The name the person chose for this agent, if any. */
  customName(key: string): string | undefined {
    return this.custom(key);
  }

  /** The person to show: the chosen name wins over the one the office picked; the look stays the picked one's. */
  display(key: string, person: PersonName): PersonName {
    const chosen = this.custom(key);
    return chosen === undefined ? person : { name: chosen, look: person.look };
  }

  async load(): Promise<void> {
    if (this.file === undefined) return;
    const raw = asRecord(await readJsonFile(this.file));
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.length > 0) this.names.set(key, value);
    }
  }

  /** The name stored for `key`, if any (read only: nothing is assigned or saved). */
  peek(key: string): string | undefined {
    return this.names.get(key);
  }

  /**
   * Name for `key` (account, session[, agent]). A stored name is reused unless another present agent already
   * uses it; otherwise a deterministic pick avoids the names in `taken`.
   */
  assign(key: string, taken: ReadonlySet<string>): PersonName {
    const stored = this.names.get(key);
    if (stored !== undefined && !taken.has(stored)) {
      return findPerson(stored) ?? { name: stored, look: pickName(key, new Set()).look };
    }
    const person = pickName(key, taken);
    this.names.delete(key);
    this.names.set(key, person.name);
    this.scheduleSave();
    return person;
  }

  private scheduleSave(): void {
    if (this.file === undefined || this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  async flush(): Promise<void> {
    if (this.file === undefined) return;
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    while (this.names.size > MAX_STORED) {
      const oldest = this.names.keys().next().value;
      if (oldest === undefined) break;
      this.names.delete(oldest);
    }
    try {
      await writeJsonAtomic(this.file, Object.fromEntries(this.names));
    } catch (error) {
      this.log.warn(`Não foi possível salvar os nomes: ${String(error)}`);
    }
  }
}

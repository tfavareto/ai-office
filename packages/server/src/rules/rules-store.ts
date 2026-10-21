// Persistence of the approval rules: <stateDir>/rules.json (rules and their counters) and rules-log.json (the
// auto-decision log). Both are written atomically with mode 0600 and read back defensively; a file that cannot be read
// is moved aside (never overwritten silently) and the office starts without it.
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { RuleBook, parseLogFile, parseRulesFile, serializeLog, serializeRules } from '@ai-office/shared';
import type { Logger } from '../log';
import { newId } from '../util/ids';
import { writeJsonAtomic } from '../util/fs-safe';

export const RULES_FILE = 'rules.json';
export const RULES_LOG_FILE = 'rules-log.json';
const SAVE_DELAY_MS = 1500;

type Loaded = { found: false } | { found: true; value: unknown } | { found: true; unreadable: true };

async function readStored(path: string): Promise<Loaded> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { found: false };
    return { found: true, unreadable: true };
  }
  try {
    return { found: true, value: JSON.parse(text) as unknown };
  } catch {
    return { found: true, unreadable: true };
  }
}

export class RulesStore {
  readonly book: RuleBook;
  private rulesDirty = false;
  private logDirty = false;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly stateDir: string,
    private readonly log: Logger,
    private readonly now: () => number,
  ) {
    this.book = new RuleBook({
      now,
      newId: () => newId(8),
      onChange: (what) => {
        if (what === 'rules') this.rulesDirty = true;
        else this.logDirty = true;
        this.scheduleSave();
      },
    });
  }

  private path(name: string): string {
    return join(this.stateDir, name);
  }

  /** Reads both files. Nothing here throws: a bad file means starting empty, with the bad file kept aside. */
  async load(): Promise<void> {
    const rules = await readStored(this.path(RULES_FILE));
    if (rules.found) {
      const parsed = 'unreadable' in rules ? undefined : parseRulesFile(rules.value);
      if (parsed === undefined || parsed.status === 'unreadable' || parsed.status === 'newer-version') {
        await this.setAside(RULES_FILE);
      } else {
        this.book.replaceRules(parsed.rules);
        if (parsed.dropped > 0) this.log.warn(`Regras de aprovação: ${parsed.dropped} regra(s) ilegível(is) foram descartadas.`);
        if (parsed.disabled > 0) this.log.warn(`Regras de aprovação: ${parsed.disabled} regra(s) de aprovar foram desativadas por não passarem na política de segurança.`);
        this.rulesDirty = parsed.status === 'migrated' || parsed.dropped > 0 || parsed.disabled > 0;
      }
    }
    const entries = await readStored(this.path(RULES_LOG_FILE));
    if (entries.found) {
      const parsed = 'unreadable' in entries ? undefined : parseLogFile(entries.value);
      if (parsed === undefined || parsed.status !== 'ok') await this.setAside(RULES_LOG_FILE);
      else this.book.replaceLog(parsed.entries);
    }
    // Loading is not a change the user made: the first save waits for a real one (or a cleanup above).
    this.logDirty = false;
    if (this.rulesDirty) this.scheduleSave();
  }

  /** Moves an unreadable file to `<name>.unreadable-<time>` so the user can recover it by hand. */
  private async setAside(name: string): Promise<void> {
    const target = `${this.path(name)}.unreadable-${this.now()}`;
    try {
      await rename(this.path(name), target);
      this.log.warn(`Não foi possível ler ${name}; o arquivo foi guardado em ${target} e as regras começam vazias.`);
    } catch (error) {
      this.log.warn(`Não foi possível ler ${name} nem guardá-lo à parte: ${String(error)}`);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  /** Writes what changed now. Returns false when the disk refused (the change stays in memory). */
  async flush(): Promise<boolean> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const writes: Promise<void>[] = [];
    const wroteRules = this.rulesDirty;
    const wroteLog = this.logDirty;
    this.rulesDirty = false;
    this.logDirty = false;
    if (wroteRules) writes.push(writeJsonAtomic(this.path(RULES_FILE), serializeRules(this.book.rules())));
    if (wroteLog) writes.push(writeJsonAtomic(this.path(RULES_LOG_FILE), serializeLog([...this.book.log()].reverse())));
    const results = await Promise.allSettled(writes);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed === undefined) return true;
    this.rulesDirty = this.rulesDirty || wroteRules;
    this.logDirty = this.logDirty || wroteLog;
    this.log.warn(`Não foi possível salvar as regras de aprovação: ${String((failed as PromiseRejectedResult).reason)}`);
    return false;
  }
}

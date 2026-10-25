// Persistence of the customization: <stateDir>/customization.json (mode 0600, written atomically, versioned). It holds
// what the person changed about names, looks, rooms and their order; nothing from the sessions. A file that cannot be
// read is moved aside, never overwritten silently, and the office starts with no customization.
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Customization,
  type CustomizationErrorBody,
  applyCustomizationPatch,
  emptyCustomization,
  readCustomization,
  readStoredCustomization,
} from '@ai-office/shared';
import type { Logger } from '../log';
import { writeJsonAtomic } from '../util/fs-safe';

export const CUSTOMIZATION_FILE = 'customization.json';

export type ChangeResult =
  { ok: true; value: Customization } | { ok: false; status: 400 | 500; error: CustomizationErrorBody };

type Read = { found: false } | { found: true; value: unknown } | { found: true; unreadable: true };

async function readStored(path: string): Promise<Read> {
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

export class CustomizationStore {
  private value: Customization = emptyCustomization();
  /** Writes run one after the other, so two quick changes never save out of order. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly stateDir: string,
    private readonly log: Logger,
    private readonly now: () => number,
    /** Called after every change that was saved (and after a reset). */
    private readonly onChange: () => void = () => undefined,
  ) {}

  private get path(): string {
    return join(this.stateDir, CUSTOMIZATION_FILE);
  }

  /** What is customized now. Treat it as read only. */
  get current(): Customization {
    return this.value;
  }

  /** Reads the file. Nothing here throws: a bad file means starting empty, with the bad file kept aside. */
  async load(): Promise<void> {
    const stored = await readStored(this.path);
    if (!stored.found) return;
    const outcome = 'unreadable' in stored ? ({ status: 'invalid' } as const) : readStoredCustomization(stored.value);
    if (outcome.status === 'invalid' || outcome.status === 'newer') {
      await this.setAside();
      return;
    }
    if (outcome.status === 'empty') return;
    this.value = outcome.value;
    if (outcome.dropped > 0)
      this.log.warn(`Personalização: ${outcome.dropped} item(ns) ilegível(is) foram descartados.`);
    if (outcome.status === 'migrated' || outcome.dropped > 0) await this.save(outcome.value);
  }

  private async setAside(): Promise<void> {
    const target = `${this.path}.unreadable-${this.now()}`;
    try {
      await rename(this.path, target);
      this.log.warn(`Não foi possível ler a personalização; o arquivo foi guardado em ${target}.`);
    } catch (error) {
      this.log.warn(`Não foi possível ler a personalização nem guardá-la à parte: ${String(error)}`);
    }
  }

  private async save(value: Customization): Promise<boolean> {
    try {
      await writeJsonAtomic(this.path, value);
      return true;
    } catch (error) {
      this.log.warn(`Não foi possível salvar a personalização: ${String(error)}`);
      return false;
    }
  }

  /** Runs a change after the ones before it; the new value is kept only when it was saved. */
  private change(next: (current: Customization) => ChangeResult): Promise<ChangeResult> {
    const run = async (): Promise<ChangeResult> => {
      const result = next(this.value);
      if (!result.ok) return result;
      if (!(await this.save(result.value))) return { ok: false, status: 500, error: { error: 'invalid-body' } };
      this.value = result.value;
      this.onChange();
      return result;
    };
    const queued = this.chain.then(run, run);
    this.chain = queued;
    return queued;
  }

  /** Replaces the whole customization (PUT). */
  replace(raw: unknown): Promise<ChangeResult> {
    return this.change(() => {
      const read = readCustomization(raw, true);
      return read.ok ? { ok: true, value: read.value } : { ok: false, status: 400, error: read.error };
    });
  }

  /** Applies a merge patch (PATCH): `null` resets a key. */
  patch(raw: unknown): Promise<ChangeResult> {
    return this.change((current) => {
      const read = applyCustomizationPatch(current, raw);
      return read.ok ? { ok: true, value: read.value } : { ok: false, status: 400, error: read.error };
    });
  }

  /** Back to the defaults for everything (DELETE). */
  reset(): Promise<ChangeResult> {
    return this.change(() => ({ ok: true, value: emptyCustomization() }));
  }
}

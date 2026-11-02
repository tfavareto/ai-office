// The note of each room: what everyone working in a project shares. The person edits it in the room's panel, agents in real
// terminals read it and add lines to it. It is never typed into an agent: an agent reads it when it decides to.
import { join } from 'node:path';
import { NOTE_MAX_CHARS, type ProjectNote } from '@ai-office/shared';
import type { Logger } from '../log';
import { cleanMessage } from '../terminal/links';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';
import { SerialWriter } from '../util/serial-writer';

const NOTES_FILE = 'notes.json';
const VERSION = 1;
export const MAX_NOTE_ROOMS = 200;
const EMPTY: ProjectNote = { text: '', updatedAt: 0 };

// Zero-width and direction characters, and the invisible tag block: text a model reads and a person does not see.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

export type NoteSave = 'saved' | 'changed' | 'too-long' | 'too-many';

/** What an agent adds is one visible line, so it cannot write another line that looks signed by someone else. */
export function cleanLine(text: string): string {
  return cleanMessage(text).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

export function parseNotes(raw: unknown): Map<string, ProjectNote> {
  const data = asRecord(raw);
  if (data.version !== VERSION) return new Map();
  return new Map(
    Object.entries(asRecord(data.notes))
      .flatMap(([room, entry]): [string, ProjectNote][] => {
        const { text, updatedAt } = asRecord(entry);
        return typeof text === 'string' && text.length <= NOTE_MAX_CHARS && typeof updatedAt === 'number'
          ? [[room, { text, updatedAt }]]
          : [];
      })
      .slice(0, MAX_NOTE_ROOMS),
  );
}

export class NoteStore {
  private notes = new Map<string, ProjectNote>();
  private readonly writer: SerialWriter;

  constructor(
    private readonly stateDir: string,
    private readonly now: () => number,
    log: Logger,
  ) {
    this.writer = new SerialWriter(
      () => writeJsonAtomic(join(stateDir, NOTES_FILE), { version: VERSION, notes: Object.fromEntries(this.notes) }),
      (error) => log.warn(`Não foi possível salvar as notas: ${String(error)}`),
    );
  }

  async load(): Promise<void> {
    this.notes = parseNotes(await readJsonFile(join(this.stateDir, NOTES_FILE)).catch(() => null));
  }

  flush(): Promise<void> {
    return this.writer.flush();
  }

  get(room: string): ProjectNote {
    return this.notes.get(room) ?? EMPTY;
  }

  /** The person's edit: refused if the note changed since it was read, so an agent's line is not lost. */
  replace(room: string, text: string, baseUpdatedAt: number): NoteSave {
    if (this.get(room).updatedAt !== baseUpdatedAt) return 'changed';
    const clean = cleanMessage(text);
    if (clean.length > NOTE_MAX_CHARS) return 'too-long';
    return this.put(room, clean) ? 'saved' : 'too-many';
  }

  /** An agent's line, signed with its name. */
  append(room: string, author: string, text: string): boolean {
    const current = this.get(room).text;
    const line = `[${cleanLine(author)}] ${cleanLine(text)}`;
    const next = current === '' ? line : `${current}\n${line}`;
    return next.length <= NOTE_MAX_CHARS && this.put(room, next);
  }

  /** A new room over the limit is refused: what someone wrote is never dropped to make space. */
  private put(room: string, text: string): boolean {
    if (!this.notes.has(room) && this.notes.size >= MAX_NOTE_ROOMS) return false;
    const updatedAt = Math.max(this.now(), this.get(room).updatedAt + 1);
    this.notes = new Map(this.notes).set(room, { text, updatedAt });
    this.writer.request();
    return true;
  }
}

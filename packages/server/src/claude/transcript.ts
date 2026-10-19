// Renders a transcript file as TranscriptEntry[] for the read-only terminal view, incrementally.
// Entries have stable global indices; tool entries are updated in place when their result arrives, so
// `next` points at the oldest tool entry still waiting for its result (clients replace tool entries by id).
import { type TranscriptEntry, describeToolUse, truncate } from '@ai-office/shared';
import { trimInput } from '../registries/permission-text';
import { JsonlTailer } from './jsonl-tailer';
import { parseLine } from './line-parser';
import type { ParsedLine } from './types';

const INITIAL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 4000;
const MAX_TEXT = 20_000;
const MAX_RESULT = 4000;

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>;

export interface RenderedPage {
  entries: TranscriptEntry[];
  next: number;
}

export class TranscriptView {
  private readonly tailer: JsonlTailer;
  private entries: TranscriptEntry[] = [];
  /** Global index of entries[0]. */
  private base = 0;
  private readonly toolIndex = new Map<string, number>();
  private readonly unresolved = new Set<number>();

  constructor(readonly path: string) {
    this.tailer = new JsonlTailer(path, { initialTailBytes: INITIAL_BYTES });
  }

  /** Reads what the file gained since the last call. Returns false when the file does not exist. */
  async update(): Promise<boolean> {
    const result = await this.tailer.read();
    if (result === undefined) return false;
    if (result.reset) this.clear();
    for (const raw of result.lines) {
      const line = parseLine(raw);
      if (line !== undefined) this.render(line);
    }
    this.trim();
    return true;
  }

  /** Entries with index >= `after` (all retained entries when `after` is undefined). */
  page(after: number | undefined): RenderedPage {
    const from = Math.max(0, (after ?? 0) - this.base);
    const smallestUnresolved = this.unresolved.size > 0 ? Math.min(...this.unresolved) : undefined;
    return { entries: this.entries.slice(from), next: smallestUnresolved ?? this.base + this.entries.length };
  }

  private clear(): void {
    this.base += this.entries.length;
    this.entries = [];
    this.toolIndex.clear();
    this.unresolved.clear();
  }

  private push(entry: TranscriptEntry): number {
    this.entries.push(entry);
    return this.base + this.entries.length - 1;
  }

  private trim(): void {
    const excess = this.entries.length - MAX_ENTRIES;
    if (excess <= 0) return;
    this.entries = this.entries.slice(excess);
    this.base += excess;
    for (const [id, index] of this.toolIndex) if (index < this.base) this.toolIndex.delete(id);
    for (const index of this.unresolved) if (index < this.base) this.unresolved.delete(index);
  }

  private render(line: ParsedLine): void {
    switch (line.kind) {
      case 'prompt':
        this.unresolved.clear();
        this.push({ kind: 'user', at: line.at, text: truncate(line.text, MAX_TEXT) });
        break;
      case 'interrupt':
        this.unresolved.clear();
        this.push({ kind: 'system', at: line.at, text: 'Interrompido pelo usuário' });
        break;
      case 'assistant':
        this.renderAssistant(line);
        break;
      case 'tool-results':
        for (const result of line.results) this.attachResult(result.toolUseId, result.text, result.isError);
        break;
      case 'system':
        if (line.subtype === 'compact_boundary') this.push({ kind: 'system', at: line.at, text: 'Conversa compactada' });
        break;
      default:
        break;
    }
  }

  private renderAssistant(line: Extract<ParsedLine, { kind: 'assistant' }>): void {
    for (const block of line.blocks) {
      if (block.type === 'text') {
        this.push({ kind: 'assistant', at: line.at, text: block.text.slice(0, MAX_TEXT) });
      } else if (block.type === 'thinking') {
        if (block.text.trim().length > 0) this.push({ kind: 'thinking', at: line.at, text: block.text.slice(0, MAX_TEXT) });
      } else {
        const draft = describeToolUse(block.name, block.input);
        const entry: ToolEntry = { kind: 'tool', at: line.at, id: block.id, name: block.name, summary: `${draft.icon} ${draft.text}`, input: trimInput(block.input) };
        const index = this.push(entry);
        this.toolIndex.set(block.id, index);
        this.unresolved.add(index);
      }
    }
  }

  private attachResult(toolUseId: string, text: string, isError: boolean): void {
    const index = this.toolIndex.get(toolUseId);
    if (index === undefined) return;
    const current = this.entries[index - this.base];
    if (current?.kind !== 'tool') return;
    this.entries[index - this.base] = { ...current, result: text.slice(0, MAX_RESULT), ...(isError ? { error: true } : {}) };
    this.unresolved.delete(index);
  }
}

/** Small LRU of open views so repeated polling only reads the new bytes. */
export class TranscriptCache {
  private readonly views = new Map<string, TranscriptView>();

  constructor(private readonly capacity = 6) {}

  async open(path: string): Promise<TranscriptView | undefined> {
    let view = this.views.get(path);
    if (view === undefined) {
      view = new TranscriptView(path);
      if (this.views.size >= this.capacity) {
        const oldest = this.views.keys().next().value;
        if (oldest !== undefined) this.views.delete(oldest);
      }
    } else {
      this.views.delete(path);
    }
    this.views.set(path, view);
    return (await view.update()) ? view : undefined;
  }
}

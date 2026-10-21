// Terminal view model: searchable text, match navigation, code-fence splitting, incremental transcript merge.
import type { TranscriptEntry, TranscriptPage } from '@ai-office/shared';
import { localized, toolSummary } from '../display';

/** Text of an entry as shown on screen (what search looks at). */
export function entrySearchText(entry: TranscriptEntry): string {
  if (entry.kind === 'tool') return [entry.name, toolSummary(entry), entry.result].filter(Boolean).join('\n');
  return entry.kind === 'system' ? localized(entry.msg, entry.text) : entry.text;
}

export interface TermMatch {
  entryIndex: number;
  /** Nth occurrence inside the entry (0-based). */
  occurrence: number;
}

export function occurrencesIn(text: string, query: string): number[] {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    starts.push(at);
    from = at + needle.length;
  }
  return starts;
}

export function findMatches(entries: readonly TranscriptEntry[], query: string): TermMatch[] {
  if (!query.trim()) return [];
  const matches: TermMatch[] = [];
  entries.forEach((entry, entryIndex) => {
    const count = occurrencesIn(entrySearchText(entry), query).length;
    for (let occurrence = 0; occurrence < count; occurrence++) matches.push({ entryIndex, occurrence });
  });
  return matches;
}

/** Next/previous match index with wrap-around; -1 when there are no matches. */
export function stepMatch(total: number, current: number, direction: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

export interface HighlightPiece {
  text: string;
  /** Occurrence number when this piece is a match, otherwise -1. */
  match: number;
}

/** Splits `text` in pieces, marking the case-insensitive occurrences of `query`. */
export function splitHighlight(text: string, query: string): HighlightPiece[] {
  const starts = occurrencesIn(text, query);
  if (starts.length === 0) return [{ text, match: -1 }];
  const pieces: HighlightPiece[] = [];
  let cursor = 0;
  starts.forEach((start, occurrence) => {
    if (start > cursor) pieces.push({ text: text.slice(cursor, start), match: -1 });
    pieces.push({ text: text.slice(start, start + query.length), match: occurrence });
    cursor = start + query.length;
  });
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), match: -1 });
  return pieces;
}

export interface TextBlock {
  kind: 'text' | 'code';
  text: string;
  lang?: string;
}

/** Splits assistant text in prose and fenced code blocks (``` fences). An unterminated fence is treated as code. */
export function splitFences(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = text.split('\n');
  let current: string[] = [];
  let inCode = false;
  let lang: string | undefined;
  const flush = (kind: 'text' | 'code'): void => {
    const body = current.join('\n');
    if (body.length > 0 || kind === 'code')
      blocks.push(kind === 'code' ? { kind, text: body, lang } : { kind, text: body });
    current = [];
  };
  for (const line of lines) {
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      if (inCode) {
        flush('code');
        inCode = false;
        lang = undefined;
      } else {
        flush('text');
        inCode = true;
        lang = fence[1] || undefined;
      }
      continue;
    }
    current.push(line);
  }
  flush(inCode ? 'code' : 'text');
  return blocks;
}

export interface TranscriptState {
  entries: TranscriptEntry[];
  next: number;
  open: boolean;
  title?: string;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { entries: [], next: 0, open: true };

/**
 * Applies a page fetched with `after = requestedAfter`. A first/full page replaces the entries; an incremental page is
 * appended only if it continues exactly where the state stopped (stale or out-of-order responses are ignored).
 */
export function mergeTranscript(state: TranscriptState, page: TranscriptPage, requestedAfter: number): TranscriptState {
  const meta = { open: page.open, title: page.title ?? state.title };
  if (requestedAfter <= 0) return { entries: [...page.entries], next: page.next, ...meta };
  if (requestedAfter !== state.next) return state;
  if (page.entries.length === 0) return page.open === state.open ? state : { ...state, open: page.open };
  return { entries: [...state.entries, ...page.entries], next: page.next, ...meta };
}

export function toolPreview(result: string | undefined, maxLines = 3): { preview: string; hiddenLines: number } {
  if (!result) return { preview: '', hiddenLines: 0 };
  const lines = result.split('\n');
  return { preview: lines.slice(0, maxLines).join('\n'), hiddenLines: Math.max(0, lines.length - maxLines) };
}

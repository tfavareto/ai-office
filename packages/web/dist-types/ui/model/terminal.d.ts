import type { TranscriptEntry, TranscriptPage } from '@ai-office/shared';
/** Text of an entry as shown on screen (what search looks at). */
export declare function entrySearchText(entry: TranscriptEntry): string;
export interface TermMatch {
    entryIndex: number;
    /** Nth occurrence inside the entry (0-based). */
    occurrence: number;
}
export declare function occurrencesIn(text: string, query: string): number[];
export declare function findMatches(entries: readonly TranscriptEntry[], query: string): TermMatch[];
/** Next/previous match index with wrap-around; -1 when there are no matches. */
export declare function stepMatch(total: number, current: number, direction: 1 | -1): number;
export interface HighlightPiece {
    text: string;
    /** Occurrence number when this piece is a match, otherwise -1. */
    match: number;
}
/** Splits `text` in pieces, marking the case-insensitive occurrences of `query`. */
export declare function splitHighlight(text: string, query: string): HighlightPiece[];
export interface TextBlock {
    kind: 'text' | 'code';
    text: string;
    lang?: string;
}
/** Splits assistant text in prose and fenced code blocks (``` fences). An unterminated fence is treated as code. */
export declare function splitFences(text: string): TextBlock[];
export interface TranscriptState {
    entries: TranscriptEntry[];
    next: number;
    open: boolean;
    title?: string;
}
export declare const EMPTY_TRANSCRIPT: TranscriptState;
/**
 * Applies a page fetched with `after = requestedAfter`. A first/full page replaces the entries; an incremental page is
 * appended only if it continues exactly where the state stopped (stale or out-of-order responses are ignored).
 */
export declare function mergeTranscript(state: TranscriptState, page: TranscriptPage, requestedAfter: number): TranscriptState;
export declare function toolPreview(result: string | undefined, maxLines?: number): {
    preview: string;
    hiddenLines: number;
};

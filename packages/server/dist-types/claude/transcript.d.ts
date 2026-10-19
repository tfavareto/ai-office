import { type TranscriptEntry } from '@ai-office/shared';
/** Entries a single page of GET /api/transcript carries. */
export declare const PAGE_SIZE = 500;
/** Longest text/result kept per entry. */
export declare const MAX_TEXT = 4096;
/** Approximate memory (serialized size) a cached view may hold; the oldest entries are dropped beyond it. */
export declare const MAX_VIEW_BYTES: number;
export interface RenderedPage {
    entries: TranscriptEntry[];
    next: number;
}
export declare class TranscriptView {
    readonly path: string;
    private readonly tailer;
    private entries;
    /** Approximate serialized size of each entry (parallel to `entries`). */
    private sizes;
    private bytes;
    /** Global index of entries[0]. */
    private base;
    private readonly toolIndex;
    private readonly unresolved;
    constructor(path: string);
    /** Reads what the file gained since the last call. Returns false when the file does not exist. */
    update(): Promise<boolean>;
    /**
     * At most PAGE_SIZE entries: the newest ones when `after` is undefined, otherwise the first ones with index >=
     * `after`. `next` is where the caller continues: after a truncated page it is the end of the page; when caught up it
     * stays at the oldest tool still waiting for its result, but never more than a page behind, so a tool that never
     * finishes cannot stall the paging.
     */
    page(after: number | undefined): RenderedPage;
    /** Approximate bytes held (for tests and diagnostics). */
    get size(): number;
    private clear;
    private push;
    private trim;
    private render;
    private renderAssistant;
    private attachResult;
}
/** Small LRU of open views so repeated polling only reads the new bytes. */
export declare class TranscriptCache {
    private readonly capacity;
    private readonly views;
    constructor(capacity?: number);
    open(path: string): Promise<TranscriptView | undefined>;
}

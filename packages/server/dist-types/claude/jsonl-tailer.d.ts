export declare const DEFAULT_TAIL_BYTES: number;
export interface TailRead {
    lines: string[];
    /** The file shrank or was replaced: previously delivered lines are no longer valid. */
    reset: boolean;
    /** True on the very first read of this tailer. */
    initial: boolean;
}
export interface TailerOptions {
    /** On the first read, start this many bytes before the end (the first partial line is dropped). */
    initialTailBytes?: number;
}
export declare class JsonlTailer {
    readonly path: string;
    private readonly options;
    private offset;
    private remainder;
    private skippingOversized;
    private started;
    private inode;
    constructor(path: string, options?: TailerOptions);
    /** Reads new complete lines. Returns undefined when the file does not exist (yet). */
    read(): Promise<TailRead | undefined>;
    private drain;
    private consume;
}

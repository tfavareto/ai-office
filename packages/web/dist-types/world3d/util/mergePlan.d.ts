export interface MergeItem {
    /** Material identity. */
    key: string;
    vertices: number;
}
export interface MergeBatch {
    key: string;
    /** Indices into the input array. */
    items: number[];
    vertices: number;
}
export declare const MAX_BATCH_VERTICES = 180000;
export declare function planMerge(items: readonly MergeItem[], maxVertices?: number): MergeBatch[];
/** Draw calls saved by merging: parts minus batches. */
export declare const savedDrawCalls: (items: readonly MergeItem[], batches: readonly MergeBatch[]) => number;

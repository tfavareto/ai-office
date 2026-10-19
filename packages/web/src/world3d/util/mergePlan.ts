// Pure planning of static-geometry merging: parts that share a material are merged into batches that stay under a
// vertex budget, so a room becomes a handful of draw calls instead of hundreds.

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

export const MAX_BATCH_VERTICES = 180_000;

export function planMerge(items: readonly MergeItem[], maxVertices = MAX_BATCH_VERTICES): MergeBatch[] {
  const open = new Map<string, MergeBatch>();
  const done: MergeBatch[] = [];
  items.forEach((item, index) => {
    let batch = open.get(item.key);
    if (batch && batch.vertices + item.vertices > maxVertices) {
      done.push(batch);
      batch = undefined;
    }
    if (!batch) {
      batch = { key: item.key, items: [], vertices: 0 };
      open.set(item.key, batch);
    }
    batch.items.push(index);
    batch.vertices += item.vertices;
  });
  return [...done, ...open.values()];
}

/** Draw calls saved by merging: parts minus batches. */
export const savedDrawCalls = (items: readonly MergeItem[], batches: readonly MergeBatch[]): number => items.length - batches.length;

// Reads the files an `apply_patch` envelope touches: "*** Add File: a", "*** Update File: b", "*** Delete File: c".

export type PatchOp = 'add' | 'update' | 'delete';

export interface PatchFile {
  op: PatchOp;
  path: string;
  added: number;
  removed: number;
}

const MAX_FILES = 200;
const MARKERS: readonly { prefix: string; op: PatchOp }[] = [
  { prefix: '*** Add File: ', op: 'add' },
  { prefix: '*** Update File: ', op: 'update' },
  { prefix: '*** Delete File: ', op: 'delete' },
];

/** The files of a patch with the number of lines added and removed in each (deleted files count no lines). */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  for (const row of patch.split('\n')) {
    const marker = MARKERS.find((candidate) => row.startsWith(candidate.prefix));
    if (marker !== undefined) {
      if (files.length >= MAX_FILES) break;
      current = { op: marker.op, path: row.slice(marker.prefix.length).trim(), added: 0, removed: 0 };
      files.push(current);
      continue;
    }
    if (current === undefined || row.startsWith('***') || row.startsWith('@@')) continue;
    if (row.startsWith('+') && current.op !== 'delete') current.added++;
    else if (row.startsWith('-') && current.op === 'update') current.removed++;
  }
  return files.filter((file) => file.path.length > 0);
}

/** Lines added and removed by a unified diff (`+++`/`---` headers do not count). */
export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of diff.split('\n')) {
    if (row.startsWith('+++') || row.startsWith('---')) continue;
    if (row.startsWith('+')) added++;
    else if (row.startsWith('-')) removed++;
  }
  return { added, removed };
}

/** Number of lines of a file's content (empty content has none). */
export function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split('\n').length;
}

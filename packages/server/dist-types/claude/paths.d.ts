/** Claude Code names project folders after the cwd with every non-alphanumeric character replaced by "-". */
export declare function encodeProjectDir(cwd: string): string;
/**
 * Finds `<dir>/projects/<project>/<sessionId>.jsonl`. Tries the folder encoded from `cwd` first, then scans the
 * project folders (the session may have changed directory, or the folder name may be truncated).
 */
export declare function findTranscript(dir: string, sessionId: string, cwd?: string): Promise<string | undefined>;
export interface SubagentMeta {
    agentType?: string;
    description?: string;
    toolUseId?: string;
}
export interface SubagentFile {
    agentId: string;
    path: string;
    meta: SubagentMeta | undefined;
}
/** `<project>/<session>.jsonl` -> `<project>/<session>/subagents`. */
export declare function subagentsDir(transcriptPath: string): string;
export declare function parseSubagentMeta(value: unknown): SubagentMeta;
/** Lists `agent-<id>.jsonl` files of a session with their `.meta.json` (undefined while it is not written yet). */
export declare function listSubagents(transcriptPath: string): Promise<SubagentFile[]>;
export interface MainTranscript {
    sessionId: string;
    path: string;
    mtimeMs: number;
    size: number;
    /** Encoded project folder name. */
    folder: string;
}
/** Main transcripts (`projects/<folder>/<session>.jsonl`) modified at or after `since`. */
export declare function listMainTranscripts(dir: string, since: number): Promise<MainTranscript[]>;

export declare const T0: number;
export declare function iso(offsetMs?: number): string;
export declare function makeTempDir(prefix?: string): Promise<string>;
export declare function removeDir(dir: string): Promise<void>;
export declare function freePort(): Promise<number>;
export declare function userLine(text: string, offsetMs: number, extra?: Record<string, unknown>): string;
export declare function toolResultLine(toolUseId: string, content: string, offsetMs: number, extra?: Record<string, unknown>, isError?: boolean): string;
export interface AssistantOptions {
    id?: string;
    model?: string;
    stopReason?: string;
    usage?: Record<string, unknown>;
    extra?: Record<string, unknown>;
}
export declare function assistantLine(blocks: unknown[], offsetMs: number, options?: AssistantOptions): string;
export declare const text: (value: string) => unknown;
export declare const thinking: (value?: string) => unknown;
export declare const toolUse: (id: string, name: string, input: Record<string, unknown>) => unknown;
export declare function jsonl(...lines: string[]): string;
export interface FakeClaudeDir {
    dir: string;
    home: string;
    transcriptPath(sessionId: string, cwd?: string): string;
    writeRegistry(pid: number, entry: Record<string, unknown>): Promise<void>;
    writeTranscript(sessionId: string, content: string, cwd?: string): Promise<string>;
    appendTranscript(sessionId: string, content: string, cwd?: string): Promise<void>;
    writeSubagent(sessionId: string, agentId: string, content: string, meta?: Record<string, unknown>, cwd?: string): Promise<void>;
    cleanup(): Promise<void>;
}
/** A temporary home with `.claude/` holding sessions/ and projects/. */
export declare function makeFakeClaude(): Promise<FakeClaudeDir>;

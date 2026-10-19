export interface RegistryEntry {
    pid: number;
    sessionId: string;
    cwd: string;
    startedAt: number;
    kind?: string;
    entrypoint?: string;
    name?: string;
    /** 'busy' | 'idle' | other values written by Claude Code. */
    status?: string;
    updatedAt?: number;
    statusUpdatedAt?: number;
}
export interface RegistrySnapshot {
    /** The sessions directory exists (the Claude Code version writes a registry). */
    supported: boolean;
    /** Entries whose process is alive. */
    open: RegistryEntry[];
}
export type PidCheck = (pid: number) => boolean;
/** Signal-0 liveness check; EPERM means the process exists but belongs to someone else. */
export declare function isPidAlive(pid: number): boolean;
export declare function parseRegistryEntry(value: unknown): RegistryEntry | undefined;
export declare function readRegistry(dir: string, alive?: PidCheck): Promise<RegistrySnapshot>;

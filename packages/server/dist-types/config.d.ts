import type { LogLevel } from './log';
export interface ServerConfig {
    port: number;
    host: string;
    /** AI_OFFICE_ALLOW_REMOTE=1: allow a non-loopback `host`. Browsers still cannot sign in remotely (no cookie is issued). */
    allowRemote: boolean;
    /** Explicit Claude config dirs (AI_OFFICE_CLAUDE_DIRS); undefined means auto-discovery. */
    claudeDirs: string[] | undefined;
    stateDir: string;
    demo: boolean;
    /** Directory with the built web app. */
    webDir: string;
    logLevel: LogLevel;
    homeDir: string;
}
export declare class ConfigError extends Error {
}
/** Parses `--flag value`, `--flag=value` and boolean flags. Unknown flags are rejected. */
export declare function parseFlags(argv: readonly string[]): Map<string, string>;
export declare function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[], defaultWebDir: string): ServerConfig;
/** True for localhost, 127.0.0.0/8 and ::1 (with or without brackets). */
export declare function isLoopbackHost(host: string): boolean;
/** True for the unspecified addresses that listen on every interface. */
export declare function isWildcardHost(host: string): boolean;

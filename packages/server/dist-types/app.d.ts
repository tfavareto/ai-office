import type { Server } from 'node:http';
import type { PidCheck } from './claude/registry';
import type { ServerConfig } from './config';
import type { AppContext } from './http/context';
import { type HttpLimits } from './http/server';
import type { Logger } from './log';
export interface AppOptions {
    now?: () => number;
    pidAlive?: PidCheck;
    /** Value of CLAUDE_CONFIG_DIR. */
    envDir?: string;
    version?: string;
    /** Overrides the HTTP request timeouts (tests). */
    httpLimits?: HttpLimits;
}
export interface App {
    context: AppContext;
    /** The underlying HTTP server (tests). */
    server: Server;
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Port the server listens on (useful when started with port 0 in tests). */
    port(): number;
}
/** Directory with the built web app, relative to this module (works from src/ and from dist/). */
export declare function defaultWebDir(): string;
export declare function readVersion(): Promise<string>;
export declare function createApp(config: ServerConfig, log: Logger, options?: AppOptions): App;

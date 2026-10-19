import { type Server } from 'node:http';
import type { AppContext } from './context';
import { Router } from './router';
import { StaticServer } from './static';
/** Sent on every response (static files and API). */
export declare const SECURITY_HEADERS: Readonly<Record<string, string>>;
/** A request must arrive completely within these limits (they do not apply to long-lived responses such as SSE). */
export declare const REQUEST_TIMEOUT_MS = 30000;
export declare const HEADERS_TIMEOUT_MS = 15000;
export interface HttpLimits {
    requestTimeoutMs: number;
    headersTimeoutMs: number;
    /** How often Node enforces the two timeouts above (Node default: 30 s). */
    checkIntervalMs?: number;
}
export interface HttpServer {
    server: Server;
    statics: StaticServer;
}
export declare function buildRouter(app: AppContext): Router;
export declare function createHttpServer(app: AppContext, statics?: StaticServer, limits?: HttpLimits): HttpServer;

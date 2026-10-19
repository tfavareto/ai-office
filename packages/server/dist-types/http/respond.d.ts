import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const BODY_LIMIT_BYTES: number;
export declare class HttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
export declare function sendError(res: ServerResponse, status: number, error: string): void;
/** Reads and parses a JSON body. Throws HttpError 413 (too large) or 400 (invalid JSON). */
export declare function readJsonBody(req: IncomingMessage, limit?: number): Promise<unknown>;
/** AbortSignal that fires when the client goes away (used by long-polls). */
export declare function closeSignal(req: IncomingMessage, res: ServerResponse): AbortSignal;

import type { IncomingMessage, ServerResponse } from 'node:http';
export interface RequestContext {
    req: IncomingMessage;
    res: ServerResponse;
    url: URL;
    params: Record<string, string>;
    /** Loopback bind + loopback Host + loopback peer. */
    local: boolean;
    /** The request carried a valid token (always true except on the public health route). */
    authed: boolean;
}
export type Handler = (ctx: RequestContext) => Promise<void> | void;
export declare class Router {
    private readonly routes;
    add(method: string, pattern: string, handler: Handler): void;
    /** Returns the handler and params for a request, or undefined when no route matches. */
    match(method: string, pathname: string): {
        handler: Handler;
        params: Record<string, string>;
    } | undefined;
}

import type { IncomingMessage, ServerResponse } from 'node:http';
export declare function mimeFor(path: string): string;
/** Absolute file path inside `root` for a URL path, or undefined when it would escape the root. */
export declare function resolveInside(root: string, urlPath: string): string | undefined;
export declare class StaticServer {
    private readonly root;
    private cachedBuild;
    constructor(root: string);
    /** Id of the served web build (hash of index.html, which references the hashed assets). */
    buildId(): Promise<string | undefined>;
    /** `indexHeaders` are added to responses that serve index.html (the session cookie). */
    handle(req: IncomingMessage, res: ServerResponse, pathname: string, indexHeaders?: Record<string, string>): Promise<void>;
    private findFile;
    private fileInfo;
    private cacheControl;
    private reply;
}

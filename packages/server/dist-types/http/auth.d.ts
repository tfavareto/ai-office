import type { IncomingMessage } from 'node:http';
/** Creates the state dir (0700) and returns the existing token, or writes a fresh one (0600). */
export declare function loadOrCreateToken(stateDir: string): Promise<string>;
/** Holds the token (loaded at startup) and checks requests against it. Fails closed until `load` ran. */
export declare class TokenAuth {
    private token;
    private tokenDigest;
    load(stateDir: string): Promise<void>;
    /** Uses a given token (tests, or after `load`). */
    use(token: string): void;
    /** The token, for tests and for the cookie. Throws before the token is loaded. */
    get value(): string;
    matches(candidate: string | undefined): boolean;
    /** True when the request carries the token as a Bearer header or as the session cookie. */
    authorize(req: IncomingMessage): boolean;
    /** `Set-Cookie` value for the page. Not `Secure`: the server speaks plain HTTP on loopback. */
    cookie(): string;
    /** Proof that this server knows the token, for a hook-chosen nonce (so the hook can check it before sending the token). */
    proof(nonce: string | null): string | undefined;
}

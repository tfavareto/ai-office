import type { IncomingMessage } from 'node:http';
export interface GuardOptions {
    port: number;
    bindHost: string;
}
export type GuardResult = {
    ok: true;
    local: boolean;
} | {
    ok: false;
    status: number;
    error: string;
};
/** Splits a Host header into hostname and port ("[::1]:4848" -> "::1", "4848"). */
export declare function parseHostHeader(value: string): {
    hostname: string;
    port: string | undefined;
};
export declare function guardRequest(req: IncomingMessage, options: GuardOptions): GuardResult;

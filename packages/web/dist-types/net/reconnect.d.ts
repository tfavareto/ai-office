export declare const RECONNECT_MIN_MS = 2000;
export declare const RECONNECT_MAX_MS = 30000;
/** Delay before reconnection attempt number `attempt` (0 = first retry). */
export declare function reconnectDelay(attempt: number): number;

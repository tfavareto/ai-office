// Reconnection backoff: 2 s, 4 s, 8 s, 16 s, then 30 s forever.
export const RECONNECT_MIN_MS = 2000;
export const RECONNECT_MAX_MS = 30_000;

/** Delay before reconnection attempt number `attempt` (0 = first retry). */
export function reconnectDelay(attempt: number): number {
  const safe = Math.max(0, Math.floor(attempt));
  // Cap the exponent: 2^5 * 2 s already exceeds the maximum.
  return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(safe, 5));
}

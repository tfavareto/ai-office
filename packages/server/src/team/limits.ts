// Every bound of the team protocol in one place: sizes, timeouts, rates and the cost of guessing a pairing code.

/** Largest frame before the keys exist (the handshake messages are tiny). */
export const HANDSHAKE_MAX_BYTES = 4096;
/** Largest encrypted frame member -> host (a share) and host -> member (the merged view). */
export const UP_MAX_BYTES = 64 * 1024;
export const DOWN_MAX_BYTES = 512 * 1024;

/** The whole handshake (connect to ready) must finish within this. */
export const HANDSHAKE_TIMEOUT_MS = 8000;
/** A ping when nothing was sent for this long; a silent peer is dropped after DEAD_AFTER_MS. */
export const PING_EVERY_MS = 10_000;
export const DEAD_AFTER_MS = 35_000;

/**
 * The first frame must arrive within this: an idle connection is cut after it, long before the whole handshake deadline.
 */
export const FIRST_FRAME_MS = 2000;
/** Once the first frame has arrived, the rest of the handshake must not stall longer than this. */
export const HANDSHAKE_STALL_MS = 4000;

/**
 * Connections that have not authenticated yet: in total, per source address and per /24 subnet. When the total is
 * reached the oldest connection of the busiest address is dropped, and addresses that authenticated lately may use
 * `PENDING_RESERVE` more.
 */
export const MAX_PENDING = 32;
export const MAX_PENDING_PER_IP = 3;
export const MAX_PENDING_PER_SUBNET = 8;
export const PENDING_RESERVE = 8;
/** How long an address that authenticated stays "known" for the reserve. */
export const TRUSTED_ADDRESS_MS = 10 * 60_000;

/** Pairing attempts per source address per minute, wrong proofs per address per minute, failed session proofs per address. */
export const PAIR_ATTEMPTS_PER_MINUTE = 10;
export const WRONG_PROOFS_PER_MINUTE = 2;
/** A pairing code is locked for an address after this many wrong proofs, and destroyed for everybody after this many in all. */
export const PAIRING_LOCK_PER_ADDRESS = 5;
export const PAIRING_DESTROY_AFTER = 1000;
export const SESSION_HELLOS_PER_MINUTE = 30;
export const SESSION_FAILURES_PER_MINUTE = 8;
/** Messages per authenticated connection: more than this in the window closes it. */
export const MESSAGES_PER_WINDOW = 40;
export const MESSAGE_WINDOW_MS = 10_000;

/** A share goes out at most this often, and at least this often as a keepalive of the state. */
export const SHARE_MIN_INTERVAL_MS = 1000;
export const SHARE_KEEPALIVE_MS = 20_000;
/** The host sends a changed view at most this often. */
export const VIEW_MIN_INTERVAL_MS = 1000;

/** Reconnect delays of a member (doubling, with jitter), and the slow retry after an error that is not ours to fix. */
export const BACKOFF_FIRST_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
export const BACKOFF_SLOW_MS = 60_000;
export const CONNECT_TIMEOUT_MS = 5000;

/**
 * The pairing code is stretched with scrypt (32 MiB, about 80 ms here) before it keys anything: whoever records a
 * pairing handshake pays this for every guess of the 2^40 codes.
 */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** Frames before a connection must be replaced (a counter never wraps; this is far below it). */
export const MAX_FRAMES_PER_KEY = 2 ** 32;

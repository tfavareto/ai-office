// Minimal leveled logger. "quiet" prints errors only, "info" is the default, "debug" adds diagnostics.
export type LogLevel = 'quiet' | 'info' | 'debug';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  debug(message: string): void;
  /** Logs at debug level once per key (used for "skipped a bad line" style diagnostics). */
  debugOnce(key: string, message: string): void;
}

export interface LogSink {
  write(text: string): void;
}

const MAX_ONCE_KEYS = 500;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export function createLogger(level: LogLevel, sink: LogSink = { write: (text) => process.stderr.write(text) }): Logger {
  const seen = new Set<string>();
  const emit = (prefix: string, message: string): void => sink.write(`${prefix}${message}\n`);
  return {
    info: (message) => {
      if (level !== 'quiet') emit('', message);
    },
    warn: (message) => {
      if (level !== 'quiet') emit('[aviso] ', message);
    },
    error: (message, error) => {
      emit('[erro] ', error === undefined ? message : `${message}: ${describeError(error)}`);
    },
    debug: (message) => {
      if (level === 'debug') emit('[debug] ', message);
    },
    debugOnce: (key, message) => {
      if (level !== 'debug' || seen.has(key)) return;
      if (seen.size >= MAX_ONCE_KEYS) seen.clear();
      seen.add(key);
      emit('[debug] ', message);
    },
  };
}

/** Logger that discards everything (tests). */
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  debugOnce: () => undefined,
};

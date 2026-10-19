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
export declare function createLogger(level: LogLevel, sink?: LogSink): Logger;
/** Logger that discards everything (tests). */
export declare const silentLogger: Logger;

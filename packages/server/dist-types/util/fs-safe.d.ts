/** Reads and parses a JSON file; undefined if it is missing or invalid. */
export declare function readJsonFile(path: string): Promise<unknown>;
/** Writes JSON atomically (temp file + rename), creating parent directories. */
export declare function writeJsonAtomic(path: string, value: unknown): Promise<void>;
/** Narrows an unknown value to a plain object. */
export declare function asRecord(value: unknown): Record<string, unknown>;
export declare function asString(value: unknown): string | undefined;
export declare function asNumber(value: unknown): number | undefined;
export declare function asArray(value: unknown): unknown[];

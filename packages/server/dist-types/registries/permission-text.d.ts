/** Short human summary of what the tool wants to do. */
export declare function summarizePermission(toolName: string, rawInput: unknown): string;
/** Label for one `permission_suggestions` entry, e.g. "Sempre permitir Bash(npm test:*) neste projeto". */
export declare function suggestionLabel(raw: unknown): string;
/** Deep-trims untrusted tool input: long strings are cut, arrays and depth are capped. */
export declare function trimInput(value: unknown, depth?: number): unknown;

/** Random hex id (URL safe). */
export declare function newId(bytes?: number): string;
/** Safe single path segment for ids taken from query strings (session ids, agent ids, dates...). */
export declare function isSafeSegment(value: string): boolean;
/** Local date as YYYY-MM-DD. */
export declare function localDateString(at: number): string;
export type Clock = () => number;

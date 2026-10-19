import { type PersonName } from '@ai-office/shared';
import type { Logger } from '../log';
export declare class NameStore {
    private readonly file;
    private readonly log;
    private readonly names;
    private saveTimer;
    constructor(file: string | undefined, log: Logger);
    static forStateDir(stateDir: string, log: Logger): NameStore;
    load(): Promise<void>;
    /**
     * Name for `key` (account, session[, agent]). A stored name is reused unless another present agent already
     * uses it; otherwise a deterministic pick avoids the names in `taken`.
     */
    assign(key: string, taken: ReadonlySet<string>): PersonName;
    private scheduleSave;
    flush(): Promise<void>;
}

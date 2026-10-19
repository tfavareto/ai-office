import { type Account } from '@ai-office/shared';
export interface DiscoverOptions {
    homeDir: string;
    explicitDirs: string[] | undefined;
    /** Value of CLAUDE_CONFIG_DIR, if any. */
    envDir: string | undefined;
}
/** Builds the Account list from directories (default account first, stable order, stable ids and colors). */
export declare function accountsFromDirs(dirs: readonly string[], homeDir: string): Account[];
export declare function discoverAccounts(options: DiscoverOptions): Promise<Account[]>;

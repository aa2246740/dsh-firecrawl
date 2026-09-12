import type { FirecrawlAccount } from './provider.js';
/** Legacy secrets are accepted only for migration; new writes keep them separate. */
export interface AccountMetadata {
    id: string;
    label: string;
    apiKey?: string;
}
export interface AccountSettings {
    accounts?: AccountMetadata[];
    apiKeys?: Record<string, string>;
}
/** Storage boundary: an unfinished account is not a usable credential. */
export declare function resolvedAccounts(config: AccountSettings): FirecrawlAccount[];
/** One atomic owner-side migration, never reconstructed from a redacted view. */
export declare function legacyAccountMigration(config: AccountSettings): AccountSettings | undefined;
/** Wire-safe metadata projection; never repeat any credential in an array write. */
export declare function metadataOnly(accounts: AccountMetadata[]): {
    id: string;
    label: string;
}[];
//# sourceMappingURL=accounts.d.ts.map
/**
 * Firecrawl-backed search provider for the DeepSeek Harness web capability
 * seam (`ctx.web`). Unlike the bundled DeepSeek search, which only accepts the
 * DeepSeek API key, this plugin lets the user bring their own Firecrawl
 * account(s) and load-balances across a pool of Firecrawl API keys.
 *
 * Two halves, one package:
 * - Host half (this file): registers the {@link FirecrawlSearchProvider} on
 *   `ctx.web` and a `settings` section so accounts are manageable.
 * - Browser half (`src/client/`): a `plugins.row.config` page that adds,
 *   edits, and removes accounts and tunes pool behavior.
 *
 * @module dsh-web-search-firecrawl
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type AccountMetadata, type AccountSettings } from './accounts.js';
import { type FirecrawlPoolStrategy } from './provider.js';
export { FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_DEFAULT_LIMIT, FIRECRAWL_PROVIDER_ID, FirecrawlSearchProvider, } from './provider.js';
export type { FirecrawlAccount, FirecrawlPoolStrategy, FirecrawlSearchProviderOptions, } from './provider.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "dsh-web-search-firecrawl";
/** The web seam this provider registers into. */
export declare const inject: string[];
/** Settings namespace carrying this provider's accounts and pool options. */
export declare const FIRECRAWL_SETTINGS_NAMESPACE = "dsh-web-search-firecrawl";
/** Plugin config (all optional — `apply` fills defaults). */
export interface Config extends AccountSettings {
    /** Endpoint base; `/v1/search` is appended. Defaults to the public API. */
    baseURL?: string;
    /** Maximum search results requested per search. Defaults to 5. */
    limit?: number;
    /** Pool scheduling: round-robin (default) or least-loaded. */
    strategy?: FirecrawlPoolStrategy;
    /** How long a rate-limited account stays cooled down, in ms. */
    cooldownMs?: number;
}
/**
 * Live profile config. Harness 0.1.7 reads editable fields from the plugin
 * Config schema; only `.volatile()` fields can change without remounting.
 * Each search calls `.get()` so one operation sees one snapshot.
 */
interface LiveConfig {
    accounts: Volatile<AccountMetadata[] | undefined>;
    apiKeys: Volatile<Record<string, string> | undefined>;
    baseURL: Volatile<string | undefined>;
    limit: Volatile<number | undefined>;
    strategy: Volatile<FirecrawlPoolStrategy | undefined>;
    cooldownMs: Volatile<number | undefined>;
}
export declare const Config: z;
/** Register the Firecrawl search provider with `ctx.web`. */
export declare function apply(ctx: Context, config: LiveConfig): void;
//# sourceMappingURL=dsh-web-search-firecrawl.d.ts.map
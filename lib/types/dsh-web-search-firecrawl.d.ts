/**
 * Firecrawl-backed search provider for the DeepSeek Harness web capability
 * seam (`ctx.web`). Unlike the bundled DeepSeek search, which only accepts the
 * DeepSeek API key, this plugin lets the user bring their own Firecrawl
 * account(s) and load-balances across a pool of Firecrawl API keys.
 *
 * Two halves, one package:
 * - Host half (this file): registers the {@link FirecrawlSearchProvider} on
 *   `ctx.web` and a `settings` section so accounts are manageable.
 * - Browser half (`src/client/`): a `settings.plugin.item` card that adds,
 *   edits, and removes accounts and tunes pool behavior.
 *
 * @module dsh-web-search-firecrawl
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type AccountSettings } from './accounts.js';
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
    /** Load-balanced pool of Firecrawl accounts (each is one API key). */
    /** Endpoint base; `/v1/search` is appended. Defaults to the public API. */
    baseURL?: string;
    /** Maximum search results requested per search. Defaults to 5. */
    limit?: number;
    /** Pool scheduling: round-robin (default) or least-loaded. */
    strategy?: FirecrawlPoolStrategy;
    /** How long a rate-limited account stays cooled down, in ms. */
    cooldownMs?: number;
}
export declare const Config: z<Config>;
/** Register the Firecrawl search provider with `ctx.web` and its settings section. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=dsh-web-search-firecrawl.d.ts.map
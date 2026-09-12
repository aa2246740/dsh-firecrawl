/**
 * Firecrawl-backed `WebSearchProvider` with a multi-account load-balanced pool.
 *
 * Firecrawl (`https://firecrawl.dev`) exposes a simple REST `/v1/search`
 * endpoint: POST `{ query, limit, ... }` with `Authorization: Bearer <key>`.
 * Each API key is rate-limited independently, so a user with several keys can
 * pool them. This provider spreads searches across the pool, fails a request
 * over to another healthy account on a rate-limit (`429`) or transient server
 * error (`5xx`), and cools an exhausted account down for a short window before
 * it is eligible again. `available()` is cheap and makes no network calls.
 *
 * The wire format and native `fetch` client are provider-private and do not use
 * `ctx.llm`.
 *
 * @module dsh-web-search-firecrawl/provider
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web';
/** Stable id this provider registers under (`ctx.web.registerSearchProvider`). */
export declare const FIRECRAWL_PROVIDER_ID = "firecrawl";
/** Default Firecrawl API base; `/v1/search` is the operation. */
export declare const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev";
/** Default maximum search results per request. */
export declare const FIRECRAWL_DEFAULT_LIMIT = 5;
/** Default pool scheduling strategy: strict round-robin across healthy accounts. */
export type FirecrawlPoolStrategy = 'round-robin' | 'least-loaded';
/**
 * One Firecrawl account. A pool needs at least one account to serve a search;
 * each account is an independent API key with its own rate limit.
 */
export interface FirecrawlAccount {
    /** Stable, user-assigned id (used as the credential's display label fallback). */
    id: string;
    /** Optional human-readable label shown in the settings card. */
    label?: string;
    /** The Firecrawl API key (kept secret; never logged or echoed). */
    apiKey: string;
}
/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface FirecrawlSearchProviderOptions {
    /** The load-balanced pool of accounts. */
    accounts: readonly FirecrawlAccount[];
    /** Endpoint base; `/v1/search` is appended. */
    baseURL: string;
    /** Maximum results requested per search; defaulted before this point. */
    limit: number;
    /** How the next account is chosen: round-robin or least-recently-used. */
    strategy: FirecrawlPoolStrategy;
    /** How long an exhausted (rate-limited) account stays cooled down, in ms. */
    cooldownMs: number;
}
/** A Firecrawl `/v1/search` result item (`data[]`). */
interface FirecrawlSearchItem {
    url?: string;
    title?: string | null;
    description?: string | null;
    /** Search engines may surface a recency/publish string; mapped to `publishedAt`. */
    publishedAt?: string | null;
}
/** A Firecrawl `/v1/search` response envelope (best-effort; fields vary by API version). */
interface FirecrawlSearchResponse {
    success?: boolean;
    data?: FirecrawlSearchItem[];
    error?: string;
}
/**
 * Map one structured Firecrawl search item to a normalized source. Blank
 * fields are omitted rather than set empty; a URL is required.
 */
export declare function mapFirecrawlItem(item: FirecrawlSearchItem): WebSearchSource | undefined;
/**
 * Map a Firecrawl `/v1/search` response to a normalized search result. `data[]`
 * is deduped by URL (Firecrawl may surface the same page more than once across
 * engines). The web service owns the final `maxResults` truncation, so
 * `truncated` is always `false` here.
 *
 * @param response - the parsed Firecrawl response body.
 * @returns the normalized result with deduped sources.
 */
export declare function mapFirecrawlResponse(response: FirecrawlSearchResponse): WebSearchResult;
/**
 * The Firecrawl-backed search provider. Spreads work across a pool of accounts,
 * failing a rate-limited or server-erroring account over to the next healthy
 * one and cooling the exhausted account down for {@link FirecrawlSearchProviderOptions.cooldownMs}.
 */
export declare class FirecrawlSearchProvider implements WebSearchProvider {
    private readonly resolveOptions;
    readonly id = "firecrawl";
    private slots;
    private next;
    /**
     * @param resolveOptions - the options for the NEXT operation, snapshotted
     * once at each operation's entry so one search never mixes two settings
     * sections. A thunk rather than a value because the settings section can
     * change between searches, and re-registering the provider to carry a new
     * account pool would make the seam's selection observable as a flicker.
     */
    constructor(resolveOptions: () => FirecrawlSearchProviderOptions);
    /** Cheap local usability check; makes no network calls. */
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    /** Reconcile the persistent slot table with the latest snapshot's accounts. */
    private syncSlots;
    /**
     * Order candidate accounts for this operation: healthy ones first (in
     * strategy order), then cooling-down ones, so a small exhausted pool still
     * degrades gracefully.
     */
    private orderCandidates;
    /** Put one account in cooldown (or extend an existing cooldown) for `cooldownMs`. */
    private startCooldown;
    private label;
    /** Extract a human-readable message from a non-ok error body, honoring abort. */
    private errorMessage;
}
export {};
//# sourceMappingURL=provider.d.ts.map
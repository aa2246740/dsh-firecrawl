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

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under (`ctx.web.registerSearchProvider`). */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl API base; `/v1/search` is the operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** Default maximum search results per request. */
export const FIRECRAWL_DEFAULT_LIMIT = 5

/** Default pool scheduling strategy: strict round-robin across healthy accounts. */
export type FirecrawlPoolStrategy = 'round-robin' | 'least-loaded'

/**
 * One Firecrawl account. A pool needs at least one account to serve a search;
 * each account is an independent API key with its own rate limit.
 */
export interface FirecrawlAccount {
  /** Stable, user-assigned id (used as the credential's display label fallback). */
  id: string
  /** Optional human-readable label shown in the settings card. */
  label?: string
  /** The Firecrawl API key (kept secret; never logged or echoed). */
  apiKey: string
}

/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface FirecrawlSearchProviderOptions {
  /** The load-balanced pool of accounts. */
  accounts: readonly FirecrawlAccount[]
  /** Endpoint base; `/v1/search` is appended. */
  baseURL: string
  /** Maximum results requested per search; defaulted before this point. */
  limit: number
  /** How the next account is chosen: round-robin or least-recently-used. */
  strategy: FirecrawlPoolStrategy
  /** How long an exhausted (rate-limited) account stays cooled down, in ms. */
  cooldownMs: number
}

/** A Firecrawl `/v1/search` result item (`data[]`). */
interface FirecrawlSearchItem {
  url?: string
  title?: string | null
  description?: string | null
  /** Search engines may surface a recency/publish string; mapped to `publishedAt`. */
  publishedAt?: string | null
}

/** A Firecrawl `/v1/search` response envelope (best-effort; fields vary by API version). */
interface FirecrawlSearchResponse {
  success?: boolean
  data?: FirecrawlSearchItem[]
  error?: string
}

/** A Firecrawl `/v1/search` error envelope. */
interface FirecrawlErrorBody {
  error?: string
  message?: string
}

/** Per-account pool bookkeeping. */
interface AccountSlot {
  account: FirecrawlAccount
  /** Number of searches this account has served (for least-loaded). */
  uses: number
  /** Millis timestamp until which the account is excluded (cooldown) or 0. */
  cooledUntil: number
  /** Last HTTP status observed; for diagnostics. */
  lastStatus: number
}

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/**
 * Map one structured Firecrawl search item to a normalized source. Blank
 * fields are omitted rather than set empty; a URL is required.
 */
export function mapFirecrawlItem(item: FirecrawlSearchItem): WebSearchSource | undefined {
  if (item.url == null || item.url.length === 0) return undefined
  return {
    url: item.url,
    ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
    ...item.description != null && item.description.length > 0 ? { snippet: item.description } : {},
    ...item.publishedAt != null && item.publishedAt.length > 0 ? { publishedAt: item.publishedAt } : {},
  }
}

/**
 * Map a Firecrawl `/v1/search` response to a normalized search result. `data[]`
 * is deduped by URL (Firecrawl may surface the same page more than once across
 * engines). The web service owns the final `maxResults` truncation, so
 * `truncated` is always `false` here.
 *
 * @param response - the parsed Firecrawl response body.
 * @returns the normalized result with deduped sources.
 */
export function mapFirecrawlResponse(response: FirecrawlSearchResponse): WebSearchResult {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const item of response.data ?? []) {
    const source = mapFirecrawlItem(item)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  return { sources, truncated: false }
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a request limit that can be sent to Firecrawl (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Firecrawl search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Race a same-process asynchronous preflight against caller cancellation. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Add endpoint/account recovery instructions to a provider failure. */
function searchEndpointError(message: string, cause?: unknown): WebError {
  return new WebError(
    `${message}\n\nThis came from the Firecrawl search provider. Check the accounts in `
    + 'Settings > Plugins > Plugin configuration > Firecrawl search: each saved account needs a '
    + 'valid Firecrawl API key, and rate-limited accounts are cooled down automatically before '
    + 'they are reused. Only the user should change or choose which account serves a search.',
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

/** A search attempt against one account, capturing the HTTP status for routing. */
interface AccountAttempt {
  response: Response
  account: AccountSlot
  endpoint: string
}

/**
 * The Firecrawl-backed search provider. Spreads work across a pool of accounts,
 * failing a rate-limited or server-erroring account over to the next healthy
 * one and cooling the exhausted account down for {@link FirecrawlSearchProviderOptions.cooldownMs}.
 */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  private slots: AccountSlot[] = []
  private next = 0

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two settings
   * sections. A thunk rather than a value because the settings section can
   * change between searches, and re-registering the provider to carry a new
   * account pool would make the seam's selection observable as a flicker.
   */
  constructor(private readonly resolveOptions: () => FirecrawlSearchProviderOptions) {}

  /** Cheap local usability check; makes no network calls. */
  available(): boolean {
    const options = this.resolveOptions()
    return options.accounts.some(account => account.apiKey.length > 0)
      && URL.canParse(options.baseURL)
      && isPositiveInteger(options.limit)
      && Number.isInteger(options.cooldownMs) && options.cooldownMs >= 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: a settings write landing inside an
    // await must not send the key read from the old section to the new pool.
    const options = this.resolveOptions()
    throwIfSearchAborted(signal)

    // Rebuild the slot table on each operation so account edits apply
    // immediately; cooldown/use bookkeeping is preserved by account id.
    const slots = this.syncSlots(options)

    if (slots.length === 0) {
      throw new WebError(
        'Firecrawl search has no accounts configured; add at least one Firecrawl API key '
        + 'through Settings > Plugins > Plugin configuration > Firecrawl search, or set the '
        + 'dsh-web-search-firecrawl config',
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
    }

    const endpoint = `${options.baseURL}/v1/search`
    const body = {
      query: request.query,
      ...request.maxResults !== undefined ? { limit: Math.min(request.maxResults, options.limit) } : { limit: options.limit },
    }

    // Gather accounts we may use: healthy (not cooling down) ones first, then
    // any cooling-down account as a last resort so a fully-exhausted pool still
    // degrades gracefully instead of failing hard.
    const ordered = this.orderCandidates(slots, options.strategy)
    const attempts: AccountAttempt[] = []
    let lastError: unknown

    for (const account of ordered) {
      throwIfSearchAborted(signal)
      let response: Response
      try {
        response = await abortable(fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'authorization': `Bearer ${account.account.apiKey}`,
            'content-type': 'application/json',
            'accept': 'application/json',
            'user-agent': USER_AGENT,
          },
          body: JSON.stringify(body),
          ...signal !== undefined ? { signal } : {},
        }), signal)
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // A transport-level failure is per-account; record it and try the next.
        lastError = error
        account.lastStatus = 0
        account.uses += 1
        this.startCooldown(account, options.cooldownMs)
        continue
      }

      account.lastStatus = response.status
      account.uses += 1

      if (response.ok) {
        try {
          const payload = await response.json() as FirecrawlSearchResponse
          return mapFirecrawlResponse(payload)
        } catch (error: unknown) {
          if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
          const message = error instanceof WebError
            ? error.message
            : `Firecrawl returned an unprocessable response body: ${String(error)}`
          throw searchEndpointError(message, error)
        }
      }

      attempts.push({ response, account, endpoint })
      // Rate-limit (429) or a transient server error (5xx) is retryable on
      // another account; 4xx (bad key, bad request) is not — a different key
      // will not fix it, so fail fast with a descriptive error.
      if (response.status === 429 || response.status >= 500) {
        this.startCooldown(account, options.cooldownMs)
        continue
      }
      const message = await this.errorMessage(response, signal)
      throw searchEndpointError(
        `Firecrawl API error (HTTP ${response.status}) for account "${this.label(account.account)}"${message.length > 0 ? `: ${message}` : ''}`,
      )
    }

    // Every account failed. Prefer the most useful non-4xx error to surface.
    if (attempts.length === 0) {
      throw searchEndpointError(
        `Firecrawl search request failed: ${String(lastError ?? 'no accounts could be reached')}`,
        lastError,
      )
    }
    const last = attempts[attempts.length - 1]
    const message = await this.errorMessage(last.response, signal)
    throw searchEndpointError(
      `Firecrawl search failed after trying ${attempts.length} account(s); last attempt was HTTP ${last.response.status}`
      + `${message.length > 0 ? `: ${message}` : ''}`,
    )
  }

  /** Reconcile the persistent slot table with the latest snapshot's accounts. */
  private syncSlots(options: FirecrawlSearchProviderOptions): AccountSlot[] {
    const byId = new Map(this.slots.map(slot => [slot.account.id, slot]))
    this.slots = options.accounts.map(account => {
      const existing = byId.get(account.id)
      if (existing !== undefined) {
        // Keep cooldown/use bookkeeping but always take the freshest key.
        existing.account = account
        return existing
      }
      return { account, uses: 0, cooledUntil: 0, lastStatus: 0 }
    })
    return this.slots
  }

  /**
   * Order candidate accounts for this operation: healthy ones first (in
   * strategy order), then cooling-down ones, so a small exhausted pool still
   * degrades gracefully.
   */
  private orderCandidates(slots: AccountSlot[], strategy: FirecrawlPoolStrategy): AccountSlot[] {
    const now = Date.now()
    const healthy = slots.filter(slot => slot.cooledUntil <= now)
    const cooling = slots.filter(slot => slot.cooledUntil > now)
    if (strategy === 'least-loaded') {
      healthy.sort((a, b) => a.uses - b.uses)
      cooling.sort((a, b) => a.uses - b.uses)
    } else {
      // Round-robin: rotate a healthy cursor so the whole pool is used evenly.
      if (healthy.length > 0) {
        this.next = this.next % healthy.length
        const rotated = healthy.slice(this.next).concat(healthy.slice(0, this.next))
        this.next = (this.next + 1) % healthy.length
        return rotated.concat(cooling)
      }
    }
    return healthy.concat(cooling)
  }

  /** Put one account in cooldown (or extend an existing cooldown) for `cooldownMs`. */
  private startCooldown(slot: AccountSlot, cooldownMs: number): void {
    const until = Date.now() + cooldownMs
    slot.cooledUntil = Math.max(slot.cooledUntil, until)
  }

  private label(account: FirecrawlAccount): string {
    return account.label !== undefined && account.label.length > 0 ? account.label : account.id
  }

  /** Extract a human-readable message from a non-ok error body, honoring abort. */
  private async errorMessage(response: Response, signal?: AbortSignal): Promise<string> {
    try {
      const parsed = await response.json() as FirecrawlErrorBody
      return parsed.error ?? parsed.message ?? ''
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      return ''
    }
  }
}

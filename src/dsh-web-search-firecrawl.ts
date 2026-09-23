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

import type { Context, Volatile } from '@deepseek-ai/cordis'
// Type-only: pulls `ctx.settings` (SettingsForms). A value import would load
// the settings package into this row; the namespace string stays plain.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { legacyAccountMigration, resolvedAccounts, type AccountMetadata, type AccountSettings } from './accounts.js'
import {
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_LIMIT,
  FIRECRAWL_PROVIDER_ID,
  type FirecrawlAccount,
  type FirecrawlPoolStrategy,
  type FirecrawlSearchProviderOptions,
} from './provider.js'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_LIMIT,
  FIRECRAWL_PROVIDER_ID,
  FirecrawlSearchProvider,
} from './provider.js'
export type {
  FirecrawlAccount,
  FirecrawlPoolStrategy,
  FirecrawlSearchProviderOptions,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Default cooldown for a rate-limited account (one minute). */
const DEFAULT_COOLDOWN_MS = 60_000

/** Settings namespace carrying this provider's accounts and pool options. */
export const FIRECRAWL_SETTINGS_NAMESPACE = 'dsh-web-search-firecrawl'

/** Plugin config (all optional — `apply` fills defaults). */
export interface Config extends AccountSettings {
  /** Endpoint base; `/v1/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Maximum search results requested per search. Defaults to 5. */
  limit?: number
  /** Pool scheduling: round-robin (default) or least-loaded. */
  strategy?: FirecrawlPoolStrategy
  /** How long a rate-limited account stays cooled down, in ms. */
  cooldownMs?: number
}

/**
 * Live profile config. Harness 0.1.7 reads editable fields from the plugin
 * Config schema; only `.volatile()` fields can change without remounting.
 * Each search calls `.get()` so one operation sees one snapshot.
 */
interface LiveConfig {
  accounts: Volatile<AccountMetadata[] | undefined>
  apiKeys: Volatile<Record<string, string> | undefined>
  baseURL: Volatile<string | undefined>
  limit: Volatile<number | undefined>
  strategy: Volatile<FirecrawlPoolStrategy | undefined>
  cooldownMs: Volatile<number | undefined>
}

export const Config: z = z.object({
  accounts: z.array(z.object({
    id: z.string(),
    label: z.string(),
    apiKey: z.string().role('secret'),
  })).volatile(),
  apiKeys: z.dict(z.string().role('secret')).volatile(),
  baseURL: z.string().default(FIRECRAWL_DEFAULT_BASE_URL).volatile(),
  limit: z.number().step(1).min(1).default(FIRECRAWL_DEFAULT_LIMIT).volatile(),
  strategy: z.union(['round-robin', 'least-loaded'] as const).default('round-robin').volatile(),
  cooldownMs: z.number().step(1).min(0).default(DEFAULT_COOLDOWN_MS).volatile(),
})

/** Copy one volatile snapshot into the plain section the provider and migration read. */
function readSection(config: LiveConfig): Config {
  const accounts = config.accounts.get()
  return {
    accounts: accounts?.map(account => ({ ...account })),
    apiKeys: { ...(config.apiKeys.get() ?? {}) },
    baseURL: config.baseURL.get(),
    limit: config.limit.get(),
    strategy: config.strategy.get(),
    cooldownMs: config.cooldownMs.get(),
  }
}

/** Project one resolved section into the options the provider serves next. */
function resolveOptions(config: Config): FirecrawlSearchProviderOptions {
  return {
    accounts: resolvedAccounts(config),
    baseURL: config.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
    limit: config.limit ?? FIRECRAWL_DEFAULT_LIMIT,
    strategy: config.strategy ?? 'round-robin',
    cooldownMs: config.cooldownMs ?? DEFAULT_COOLDOWN_MS,
  }
}

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: LiveConfig): void {
  console.log('[my-plugins/dsh-web-search-firecrawl] loaded')
  // Settings are this entry's volatile Config. The custom page owns the UI,
  // so automatic schema pages stay off. Legacy per-account keys move into the
  // secret dictionary once Settings can write the profile entry.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    return (async () => {
      const migration = legacyAccountMigration(readSection(config))
      if (migration !== undefined) await settingsCtx.settings.update(FIRECRAWL_SETTINGS_NAMESPACE, migration)
    })()
  })
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(() => resolveOptions(readSection(config))))
}

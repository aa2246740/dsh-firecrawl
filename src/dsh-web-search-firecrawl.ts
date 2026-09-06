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

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the Host runtime (0.1.2-rc.1) no longer ships a
// `settingsNamespace` value export — the namespace is validated structurally
// at `register`. A value import would fail the row mount, so the brand crosses
// only as a type and the plain kebab-case string rides at runtime.
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { legacyAccountMigration, resolvedAccounts, type AccountSettings } from './accounts.js'
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
  /** Load-balanced pool of Firecrawl accounts (each is one API key). */
  /** Endpoint base; `/v1/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Maximum search results requested per search. Defaults to 5. */
  limit?: number
  /** Pool scheduling: round-robin (default) or least-loaded. */
  strategy?: FirecrawlPoolStrategy
  /** How long a rate-limited account stays cooled down, in ms. */
  cooldownMs?: number
}

export const Config: z<Config> = z.object({
  accounts: z.array(z.object({
    id: z.string(),
    label: z.string(),
    apiKey: z.string().role('secret'),
  })),
  apiKeys: z.dict(z.string().role('secret')),
  baseURL: z.string(),
  limit: z.number().step(1).min(1),
  strategy: z.union(['round-robin', 'least-loaded'] as const),
  cooldownMs: z.number().step(1).min(0),
})

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

/** Register the Firecrawl search provider with `ctx.web` and its settings section. */
export function apply(ctx: Context, config: Config): void {
  console.log('[my-plugins/dsh-web-search-firecrawl] loaded')
  let current: () => Config = () => config
  // `register` (not a staged form): the provider projects the section per
  // search, so a committed change needs no re-registration — the watcher only
  // swaps the thunk the next search snapshots.
  ctx.inject(['settings'], async (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      FIRECRAWL_SETTINGS_NAMESPACE as SettingsNamespace, Config, { base: config },
    )
    const migration = legacyAccountMigration(scope.get())
    if (migration !== undefined) await scope.update(migration)
    current = () => scope.get()
  })
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(() => resolveOptions(current())))
}

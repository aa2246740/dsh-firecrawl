import type { FirecrawlAccount } from './provider.js'

/** Legacy secrets are accepted only for migration; new writes keep them separate. */
export interface AccountMetadata {
  id: string
  label: string
  apiKey?: string
}

export interface AccountSettings {
  accounts?: AccountMetadata[]
  apiKeys?: Record<string, string>
}

/** Storage boundary: an unfinished account is not a usable credential. */
export function resolvedAccounts(config: AccountSettings): FirecrawlAccount[] {
  return (config.accounts ?? []).flatMap(account => {
    const apiKey = config.apiKeys?.[account.id] ?? account.apiKey
    return typeof apiKey === 'string' && apiKey.trim().length > 0
      ? [{ id: account.id, label: account.label, apiKey }]
      : []
  })
}

/** One atomic owner-side migration, never reconstructed from a redacted view. */
export function legacyAccountMigration(config: AccountSettings): AccountSettings | undefined {
  if (!(config.accounts ?? []).some(account => account.apiKey !== undefined)) return undefined
  const apiKeys = { ...config.apiKeys }
  const accounts = (config.accounts ?? []).map(({ id, label, apiKey }) => {
    if (!Object.hasOwn(apiKeys, id) && typeof apiKey === 'string' && apiKey.trim()) apiKeys[id] = apiKey
    return { id, label }
  })
  return { accounts, apiKeys }
}

/** Wire-safe metadata projection; never repeat any credential in an array write. */
export function metadataOnly(accounts: AccountMetadata[]): { id: string; label: string }[] {
  return accounts.map(({ id, label }) => ({ id, label }))
}

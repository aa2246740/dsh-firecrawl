import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import { metadataOnly, type AccountSettings } from '../accounts.js'

/** All edits use the namespace's revision fence and never read credential values. */
export class AccountsController {
  constructor(private readonly scope: SettingsScope<AccountSettings>) {}

  private snapshot() {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) throw new Error('Settings are not writable')
    return { accounts: metadataOnly(snapshot.value?.accounts ?? []), revision: snapshot.revision }
  }

  add(id: string): Promise<void> {
    const { accounts, revision } = this.snapshot()
    return this.scope.mutate([{ op: 'set', path: ['accounts'], value: [...accounts, { id, label: '' }] }], revision)
  }

  save(id: string, label: string, key: string): Promise<void> {
    const { accounts, revision } = this.snapshot()
    if (!accounts.some(account => account.id === id)) throw new Error('Account was removed')
    const ops: SettingsPathOpView[] = [{ op: 'set', path: ['accounts'], value: accounts.map(account => account.id === id ? { id, label } : account) }]
    if (key.trim()) ops.push({ op: 'set', path: ['apiKeys', id], value: key.trim() })
    return this.scope.mutate(ops, revision)
  }

  remove(id: string): Promise<void> {
    const { accounts, revision } = this.snapshot()
    return this.scope.mutate([
      { op: 'set', path: ['accounts'], value: accounts.filter(account => account.id !== id) },
      { op: 'unset', path: ['apiKeys', id] },
    ], revision)
  }
}

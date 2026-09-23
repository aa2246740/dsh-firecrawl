import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import { metadataOnly, type AccountSettings } from '../accounts.js'

/** All edits use the namespace's revision fence and never read credential values. */
export class AccountsController {
  constructor(private readonly form: ConfigForm<AccountSettings>) {}

  private snapshot() {
    const snapshot = this.form.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable || snapshot.revision === undefined) {
      throw new Error('Settings are not writable')
    }
    return { accounts: metadataOnly(snapshot.value?.accounts ?? []), revision: snapshot.revision }
  }

  private async commit(ops: readonly SettingsPathOpView[], revision: number): Promise<void> {
    const accepted = await this.form.mutate(ops, revision)
    if (!accepted) throw new Error('Settings write was not accepted')
  }

  add(id: string): Promise<void> {
    const { accounts, revision } = this.snapshot()
    return this.commit([{ op: 'set', path: ['accounts'], value: [...accounts, { id, label: '' }] }], revision)
  }

  save(id: string, label: string, key: string): Promise<void> {
    const { accounts, revision } = this.snapshot()
    if (!accounts.some(account => account.id === id)) throw new Error('Account was removed')
    const ops: SettingsPathOpView[] = [{ op: 'set', path: ['accounts'], value: accounts.map(account => account.id === id ? { id, label } : account) }]
    if (key.trim()) ops.push({ op: 'set', path: ['apiKeys', id], value: key.trim() })
    return this.commit(ops, revision)
  }

  remove(id: string): Promise<void> {
    const { accounts, revision } = this.snapshot()
    return this.commit([
      { op: 'set', path: ['accounts'], value: accounts.filter(account => account.id !== id) },
      { op: 'unset', path: ['apiKeys', id] },
    ], revision)
  }
}

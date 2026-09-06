import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SettingsDescribeValue } from '@deepseek-ai/dsh-settings/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { AccountSettings, AccountMetadata } from '../accounts.js'
import { AccountsController } from './accounts-controller.js'

const NAMESPACE = 'dsh-web-search-firecrawl'
interface Section extends AccountSettings {
  limit?: number
  strategy?: 'round-robin' | 'least-loaded'
  cooldownMs?: number
}
export const name = 'dsh-web-search-firecrawl-client'
export const inject = ['slots', 'settingsScope', 'remote', 'remote.settings']

export function apply(ctx: Context): void {
  const scope = ctx.settingsScope.bind<Section>({ namespace: NAMESPACE })
  const accounts = new AccountsController(scope)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: NAMESPACE },
    () => <FirecrawlCard scope={scope} accounts={accounts} ctx={ctx} />))
}

const inputStyle = { padding: '6px 8px', border: '1px solid #8886', borderRadius: 6, background: 'transparent', color: 'inherit' }
const buttonStyle = { ...inputStyle, cursor: 'pointer' }

function AccountRow({ account, configured, busy, save, remove }: {
  account: AccountMetadata; configured: boolean | undefined; busy: boolean
  save: (label: string, key: string) => Promise<void>; remove: () => void
}): ReactNode {
  const [label, setLabel] = useState(account.label)
  const [key, setKey] = useState('')
  useEffect(() => { setLabel(account.label) }, [account.label])
  return <fieldset style={{ border: '1px solid #8884', borderRadius: 6, padding: 10, marginTop: 10 }} disabled={busy}>
    <legend>{account.label || '新账号'}</legend>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
      <label style={{ display: 'grid', gap: 4 }}>名称
        <input aria-label="账号名称" style={inputStyle} value={label} onChange={event => setLabel(event.target.value)} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>API key · {configured === undefined ? '状态待确认' : configured ? '已配置' : '未配置'}
        <input aria-label="Firecrawl API key" style={inputStyle} type="password" autoComplete="off" value={key}
          placeholder={configured ? '留空保留已有 key' : 'fc-...'} onChange={event => setKey(event.target.value)} />
      </label>
      <button style={buttonStyle} onClick={() => { void save(label, key).then(() => setKey('')).catch(() => {}) }}>保存</button>
      <button style={buttonStyle} onClick={remove}>移除账号</button>
    </div>
  </fieldset>
}

function FirecrawlCard({ scope, accounts: controller, ctx }: { scope: SettingsScope<Section>; accounts: AccountsController; ctx: Context }): ReactNode {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<Record<string, boolean> | undefined>()
  // The API reports configured-state metadata, never credential values.
  useEffect(() => {
    let current = true
    setConfigured(undefined)
    void ctx.remote.settings.describe().then((result: { ok: true; value: SettingsDescribeValue } | { ok: false }) => {
      if (!current || !result.ok) return
      const ns = result.value.namespaces.find(item => item.ns === NAMESPACE)
      if (ns) setConfigured(Object.fromEntries(ns.secrets.filter(secret => secret.path[0] === 'apiKeys').map(secret => [secret.path[1], secret.set])))
    }).catch(() => {})
    return () => { current = false }
  }, [snapshot.revision, ctx])

  if (snapshot.status !== 'ready') return null
  const section = snapshot.value ?? {}
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    try { await action() }
    catch (error) { setError('保存失败，未确认写入。请重新打开设置后重试。'); throw error }
    finally { setBusy(false) }
  }
  function act(action: () => Promise<void>): void { void run(action).catch(() => {}) }
  const disabled = busy || !snapshot.writable
  return <li style={{ listStyle: 'none', border: '1px solid #8884', borderRadius: 8, margin: '8px 0' }}>
    <button style={{ ...buttonStyle, border: 0, width: '100%', textAlign: 'left', padding: 14 }} aria-expanded={open} onClick={() => setOpen(!open)}>
      <strong>Firecrawl search</strong><div style={{ opacity: 0.7, fontSize: 12 }}>搜索账号与负载均衡 · {open ? '收起' : '展开'}</div>
    </button>
    {open && <div style={{ padding: '0 14px 14px' }}>
      {(section.accounts ?? []).map(account => <AccountRow key={account.id} account={account}
        configured={configured === undefined ? undefined : configured[account.id] === true} busy={disabled}
        save={(label, key) => run(() => controller.save(account.id, label, key))}
        remove={() => act(() => controller.remove(account.id))} />)}
      <button style={{ ...buttonStyle, marginTop: 10 }} disabled={disabled} onClick={() => act(() => controller.add(crypto.randomUUID()))}>添加账号</button>
      <p style={{ fontSize: 12, opacity: 0.75 }}>Key 只写入、不回显。填写后点“保存”；只改名称不会清除已有 key。</p>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>策略 <select aria-label="账号策略" style={inputStyle} value={section.strategy ?? 'round-robin'} onChange={event => act(() => scope.set('strategy', event.target.value))}>
          <option value="round-robin">轮询</option><option value="least-loaded">最少使用</option>
        </select></label>
        <label>结果数 <input aria-label="搜索结果数" style={{ ...inputStyle, width: 65 }} type="number" min={1} defaultValue={section.limit ?? 5}
          onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value > 0) act(() => scope.set('limit', value)) }} /></label>
        <label>冷却毫秒 <input aria-label="冷却毫秒" style={{ ...inputStyle, width: 90 }} type="number" min={0} defaultValue={section.cooldownMs ?? 60000}
          onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0) act(() => scope.set('cooldownMs', value)) }} /></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <p style={{ fontSize: 12, opacity: 0.75 }}>由外部 DSHX 在当前 Host 的 watched patch 设置 <code>web.config.searchProvider: firecrawl</code> 后生效，无需为了路由配置重启。官方显式配置优先于环境变量。模型路由若隐藏 web_search，请使用支持该工具的新会话。</p>
    </div>}
  </li>
}

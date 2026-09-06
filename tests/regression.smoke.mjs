import { it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, redactSecrets } from '@deepseek-ai/dsh-settings'
import { apply, Config } from '../lib/dsh-web-search-firecrawl.js'
import { AccountsController } from '../lib/types/client/accounts-controller.js'
import { legacyAccountMigration } from '../lib/types/accounts.js'

const ns = 'dsh-web-search-firecrawl'
const fakeKey = 'fixture-only-never-a-real-credential'
class MemorySettings extends SettingsProvider {
  constructor(ctx, options) { super(ctx); this.doc = structuredClone(options.doc) }
  get writable() { return true }
  async load() { return structuredClone(this.doc) }
  async persist(namespace, section) { this.doc[namespace] = structuredClone(section) }
}

async function fixture(config) {
  const ctx = new Context()
  const fiber = ctx.plugin(MemorySettings, { doc: { [ns]: config } })
  await fiber
  const settings = ctx.get('settings')
  const pending = []
  let provider
  apply({
    inject(_deps, callback) { pending.push(callback({ settings })) },
    web: { registerSearchProvider(value) { provider = value } },
  }, {})
  await Promise.all(pending)
  const descriptor = () => settings.describe({ redactSecrets: true }).find(item => item.ns === ns)
  const ui = new AccountsController({
    getSnapshot() { const view = descriptor(); return { status: 'ready', writable: true, value: view.value, revision: view.revision } },
    mutate(ops, revision) { return settings.mutate(ns, ops, revision) },
  })
  return { settings, provider, descriptor, ui, close: () => fiber.dispose() }
}

it('actual registered provider tolerates an unfinished account without apiKey', async () => {
  const f = await fixture({ accounts: [{ id: 'draft', label: 'unfinished' }] })
  try { assert.equal(f.provider.available(), false) } finally { await f.close() }
})

it('migrates valid legacy keys atomically, preserving new keys and unrelated options', async () => {
  const f = await fixture({ accounts: [{ id: 'one', label: 'old', apiKey: fakeKey }, { id: 'draft', label: '' }], limit: 3, cooldownMs: 0 })
  try {
    assert.equal(f.provider.available(), true)
    assert.equal(f.settings.doc[ns].apiKeys.one, fakeKey)
    assert.equal(f.settings.doc[ns].accounts[0].apiKey, undefined)
    assert.equal(f.settings.doc[ns].limit, 3)
    assert.equal(legacyAccountMigration(f.settings.doc[ns]), undefined)
    const migrated = legacyAccountMigration({ accounts: [{ id: 'one', label: '', apiKey: 'old-fixture' }], apiKeys: { one: fakeKey } })
    assert.equal(migrated.apiKeys.one, fakeKey)
  } finally { await f.close() }
})

it('actual redaction plus client label/add/remove mutations preserve unrelated secrets', async () => {
  const f = await fixture({ accounts: [{ id: 'one', label: 'main' }], apiKeys: { one: fakeKey } })
  try {
    assert.equal(JSON.stringify(f.descriptor().value).includes(fakeKey), false)
    assert.ok(f.descriptor().secrets.some(secret => secret.path.join('.') === 'apiKeys.one' && secret.set))
    await f.ui.save('one', 'renamed', '')
    await f.ui.add('two')
    assert.equal(f.settings.doc[ns].apiKeys.one, fakeKey)
    await f.ui.save('two', 'second', 'second-fixture-only')
    await f.ui.remove('two')
    assert.equal(f.settings.doc[ns].apiKeys.one, fakeKey)
    assert.equal(f.settings.doc[ns].apiKeys.two, undefined)
    assert.equal(f.settings.doc[ns].accounts[0].label, 'renamed')
    assert.equal(JSON.stringify(redactSecrets(Config, f.settings.doc[ns]).value).includes(fakeKey), false)
  } finally { await f.close() }
})

it('configured provider performs the real search method with saved credentials and caps results', async () => {
  const f = await fixture({ accounts: [{ id: 'draft', label: '' }, { id: 'one', label: 'main' }], apiKeys: { one: fakeKey }, limit: 1 })
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async (url, init) => {
    called = true
    assert.equal(url, 'https://api.firecrawl.dev/v1/search')
    assert.equal(init.headers.authorization, `Bearer ${fakeKey}`)
    assert.equal(JSON.parse(init.body).query, 'Firecrawl official documentation')
    return new Response(JSON.stringify({ success: true, data: [{ url: 'https://docs.firecrawl.dev', title: 'Firecrawl Docs', description: 'Official docs' }] }), { status: 200 })
  }
  try {
    assert.equal(f.provider.available(), true)
    const result = await f.provider.search({ query: 'Firecrawl official documentation', maxResults: 1 })
    assert.equal(called, true)
    assert.equal(result.sources[0].url, 'https://docs.firecrawl.dev')
  } finally { globalThis.fetch = originalFetch; await f.close() }
})

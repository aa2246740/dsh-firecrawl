// Local browser acceptance; deliberately separate from portable node:test tests.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
const { launchPinnedChromium } = await import(`${homedir()}/.codex/playwright-runtime/runtime.mjs`)
const server = createServer((_req, res) => res.end('<html lang="zh"><style>body{font:14px system-ui;margin:35px;max-width:1000px;color:#222}button,input,select{font:inherit}button:disabled{opacity:.5}</style><div id="root"></div></html>'))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await launchPinnedChromium()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.addScriptTag({ path: resolve('node_modules/react/umd/react.development.js') })
  await page.addScriptTag({ path: resolve('node_modules/react-dom/umd/react-dom.development.js') })
  await page.evaluate(() => {
    const doc = { accounts: [{ id: 'one', label: '主账号' }], apiKeys: { one: 'fixture-only-key' }, limit: 5 }
    const listeners = new Set()
    let snapshot
    let revision = 0
    const publish = () => {
      snapshot = { status: 'ready', writable: true, revision: revision++, value: { ...structuredClone(doc), apiKeys: {} } }
      for (const callback of listeners) callback()
    }
    const mutate = async (ops, expected) => {
      if (expected !== undefined && expected !== snapshot.revision) throw Error('revision conflict')
      for (const op of ops) {
        let cursor = doc
        for (const part of op.path.slice(0, -1)) cursor = cursor[part] ??= {}
        const key = op.path.at(-1)
        if (op.op === 'unset') delete cursor[key]
        else cursor[key] = structuredClone(op.value)
      }
      publish()
    }
    const scope = {
      getSnapshot: () => snapshot,
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      mutate: async (ops, expected) => { await mutate(ops, expected); return true },
      set: async (field, value) => { await mutate([{ op: 'set', path: [field], value }]); return true },
      unset: async () => true,
    }
    publish()
    window.fixture = { doc }
    window.__ModuleLoader__ = { load({ factory }) {
      const jsx = (type, props, key) => React.createElement(type, { ...props, ...(key === undefined ? {} : { key }) })
      const plugin = factory(id => id === 'react' ? React : { jsx, jsxs: jsx, Fragment: React.Fragment })
      plugin.apply({
        effect(register) { register() },
        configForms: {
          get: () => scope,
          whileServed(_namespaces, register) { register(new Set(['dsh-web-search-firecrawl'])); return () => {} },
        },
        remote: { settings: { describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'dsh-web-search-firecrawl', secrets: Object.keys(doc.apiKeys).map(id => ({ path: ['apiKeys', id], set: true })) }] } }) } },
        slots: { inject(_name, callback) { callback() }, register(_spec, Component) { ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component, { view: 'page' })) } },
      })
    } }
  })
  await page.addScriptTag({ path: resolve('lib/client.js') })
  await page.getByRole('button', { name: /Firecrawl search/ }).click()
  await page.getByText('API key · 已配置', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Firecrawl API key', { exact: true }).inputValue(), '')
  await page.getByLabel('账号名称', { exact: true }).fill('')
  await page.getByLabel('账号名称', { exact: true }).pressSequentially('Renamed account', { delay: 5 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '添加账号', exact: true }).click()
  const keys = page.getByLabel('Firecrawl API key', { exact: true })
  await keys.nth(1).fill('second-fixture-key')
  await page.getByLabel('账号名称', { exact: true }).nth(1).fill('第二账号')
  await page.getByRole('button', { name: '保存', exact: true }).nth(1).click()
  await page.getByRole('button', { name: '移除账号', exact: true }).nth(1).click()
  const proof = await page.evaluate(() => ({ kept: fixture.doc.apiKeys.one === 'fixture-only-key', accounts: fixture.doc.accounts.length, name: fixture.doc.accounts[0].label, keys: Object.keys(fixture.doc.apiKeys).length }))
  assert.deepEqual(proof, { kept: true, accounts: 1, name: 'Renamed account', keys: 1 })
  assert.equal(await keys.first().inputValue(), '')
  assert.deepEqual(errors, [])
  await mkdir('outputs', { recursive: true })
  await page.screenshot({ path: 'outputs/account-settings-acceptance.png', fullPage: true })
  console.log('UI_PASS: sequential typing, explicit save, configured-state, no secret echo, add/remove preserves other key')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

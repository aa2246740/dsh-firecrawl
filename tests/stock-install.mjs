import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import semver from 'semver'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
const host = readFileSync(join(root, 'lib/dsh-web-search-firecrawl.js'), 'utf8')
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')

describe('stock DSH bundle', () => {
  it('declares dsh.bundle.patch and ships cordis.patch.yml', () => {
    assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.equal(pkg.scripts?.prepare, undefined)
    assert.ok(pkg.files.includes('cordis.patch.yml'))
    assert.match(patch, /name: dsh-web-search-firecrawl/)
    assert.match(patch, /searchProvider: firecrawl/)
    assert.match(patch, /fetchProvider: http/)
  })

  it('commits built Host and lazy-CJS client entries', () => {
    assert.ok(existsSync(join(root, 'lib/dsh-web-search-firecrawl.js')))
    assert.ok(existsSync(join(root, 'lib/client.js')))
    assert.match(host, /export \{/)
    assert.match(client, /^window\.__ModuleLoader__\.load\(\{/)
    assert.match(client, /id: "dsh-web-search-firecrawl"/)
    assert.match(client, /autoComplete: "new-password"/)
  })

  it('README gives official Desktop and Web installation paths', () => {
    assert.match(readme, /设置 → 插件 → 添加插件/)
    assert.match(readme, /github:aa2246740\/dsh-firecrawl#v0\.1\.4/)
    assert.match(readme, /dsh plugin --profile web add github:aa2246740\/dsh-firecrawl#v0\.1\.4/)
    assert.match(readme, /0\.2\.0-rc\.2/)
    assert.doesNotMatch(readme, /activate-new-client|my-plugins|DSHX_HARNESS|dshx/i)
  })

  it('Harness peers accept 0.2.0-rc.2 and stable 0.2.0, and reject alphas and 0.1.7-rc.2', () => {
    const peers = pkg.peerDependencies
    const dev = pkg.devDependencies
    const range = '>=0.2.0-rc.1 <0.2.1'
    assert.equal(peers['@deepseek-ai/dsh'], range)
    for (const name of [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-ui-plugin-manager',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-web',
    ]) {
      assert.equal(peers[name], range)
      assert.equal(dev[name], range)
    }
    for (const name of [
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-renderer',
    ]) {
      assert.equal(dev[name], range)
    }
    assert.equal(peers['@deepseek-ai/dsh-client-ui-settings-plugins'], undefined)
    assert.equal(semver.satisfies('0.2.0-rc.2', range), true)
    assert.equal(semver.satisfies('0.2.0', range), true)
    assert.equal(semver.satisfies('0.2.0-alpha.1', range), false)
    assert.equal(semver.satisfies('0.1.7-rc.2', range), false)
    const declared = JSON.stringify({ peers, dev })
    assert.doesNotMatch(declared, /0\.1\.7-rc\.1|0\.1\.7-rc\.2|0\.2\.0-alpha/)
    assert.match(lock, /'@deepseek-ai\/dsh-web@0\.2\.0-rc\.2'/)
    assert.doesNotMatch(lock, /@0\.1\.7-rc\.2'/)
  })
})

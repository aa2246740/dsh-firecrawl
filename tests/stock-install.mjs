import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
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
  })

  it('README leads with the official stock one-liner and names pnpm', () => {
    const fence = readme.match(/```sh\n([\s\S]*?)```/)
    assert.equal(fence?.[1].trim(), 'dsh plugin --profile web add github:aa2246740/dsh-firecrawl')
    assert.match(readme, /\*\*pnpm\*\*/)
    assert.match(readme, /0\.1\.5-rc\.3/)
    assert.doesNotMatch(readme, /activate-new-client|my-plugins|DSHX_HARNESS|dshx /)
  })

  it('Harness peers accept 0.1.5-rc.3 and stay off 0.1.7 alphas', () => {
    const peers = pkg.peerDependencies
    const dev = pkg.devDependencies
    for (const name of [
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-plugins',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-web',
    ]) {
      assert.equal(peers[name], '^0.1.5-rc.3')
      assert.equal(dev[name], '^0.1.5-rc.3')
    }
    for (const name of [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-scope',
      '@deepseek-ai/dsh-invariants',
    ]) {
      assert.equal(dev[name], '^0.1.5-rc.3')
    }
    const declared = JSON.stringify({ peers, dev })
    assert.doesNotMatch(declared, /0\.1\.2-rc\.1|0\.1\.7-alpha/)
  })
})

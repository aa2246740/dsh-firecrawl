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
    assert.doesNotMatch(readme, /activate-new-client|my-plugins|DSHX_HARNESS|dshx /)
  })
})

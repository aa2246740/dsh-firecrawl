/**
 * Focused smoke tests for the Firecrawl provider pool: response mapping,
 * round-robin scheduling, 429 failover with cooldown, and the empty-pool
 * credential error. Runs against the built Host bundle with a scripted
 * `globalThis.fetch` — no network, no Host required.
 *
 * Run: `pnpm test` (builds first).
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { FirecrawlSearchProvider } from '../lib/dsh-web-search-firecrawl.js'

/** One scripted HTTP answer, selected per test. */
let responder = (_url, _init) => {
  throw new Error('responder not set')
}

/** Authorization keys seen, in call order. */
let seenKeys = []

function keyOf(init) {
  const header = init?.headers?.authorization ?? ''
  return header.replace(/^Bearer /, '')
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function okPayload(items) {
  return { success: true, data: items }
}

function providerWith(accounts, overrides = {}) {
  return new FirecrawlSearchProvider(() => ({
    accounts,
    baseURL: 'https://api.firecrawl.dev',
    limit: 5,
    strategy: 'round-robin',
    cooldownMs: 60_000,
    ...overrides,
  }))
}

beforeEach(() => {
  seenKeys = []
  globalThis.fetch = async (url, init) => {
    seenKeys.push(keyOf(init))
    return responder(url, init)
  }
})

describe('mapFirecrawlResponse', () => {
  it('maps url/title/description and dedupes by url', async () => {
    responder = () => jsonResponse(200, okPayload([
      { url: 'https://a.example/', title: 'A', description: 'first' },
      { url: 'https://b.example/', title: '', description: '' },
      { url: 'https://a.example/', title: 'A dup', description: 'dup' },
      { title: 'no url' },
    ]))
    const provider = providerWith([{ id: 'a', apiKey: 'k-a' }])
    const result = await provider.search({ query: 'q' })
    assert.equal(result.truncated, false)
    assert.deepEqual(result.sources, [
      { url: 'https://a.example/', title: 'A', snippet: 'first' },
      { url: 'https://b.example/' },
    ])
  })
})

describe('round-robin pool', () => {
  it('alternates accounts across searches', async () => {
    responder = () => jsonResponse(200, okPayload([]))
    const provider = providerWith([{ id: 'a', apiKey: 'k-a' }, { id: 'b', apiKey: 'k-b' }])
    assert.equal(provider.available(), true)
    await provider.search({ query: '1' })
    await provider.search({ query: '2' })
    await provider.search({ query: '3' })
    await provider.search({ query: '4' })
    assert.deepEqual(seenKeys, ['k-a', 'k-b', 'k-a', 'k-b'])
  })

  it('sends limit bounded by maxResults', async () => {
    let bodies = []
    responder = (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return jsonResponse(200, okPayload([]))
    }
    const provider = providerWith([{ id: 'a', apiKey: 'k-a' }])
    await provider.search({ query: 'q', maxResults: 2 })
    await provider.search({ query: 'q', maxResults: 50 })
    assert.deepEqual(bodies.map(b => b.limit), [2, 5])
  })
})

describe('failover', () => {
  it('fails a 429 over to the next account and cools the first down', async () => {
    responder = (_url, init) => keyOf(init) === 'k-a'
      ? jsonResponse(429, { error: 'rate limited' })
      : jsonResponse(200, okPayload([{ url: 'https://b.example/' }]))
    const provider = providerWith([{ id: 'a', apiKey: 'k-a' }, { id: 'b', apiKey: 'k-b' }])
    const first = await provider.search({ query: 'q' })
    assert.deepEqual(first.sources, [{ url: 'https://b.example/' }])
    assert.deepEqual(seenKeys, ['k-a', 'k-b'])
    // A is cooling down: the next search goes straight to B.
    await provider.search({ query: 'q2' })
    assert.deepEqual(seenKeys, ['k-a', 'k-b', 'k-b'])
  })

  it('throws WEB_PROVIDER_ERROR when every account is exhausted', async () => {
    responder = () => jsonResponse(429, { error: 'slow down' })
    const provider = providerWith([{ id: 'a', apiKey: 'k-a' }], { cooldownMs: 1 })
    await assert.rejects(provider.search({ query: 'q' }), (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      return true
    })
  })
})

describe('empty pool', () => {
  it('is unavailable and raises the credential error', async () => {
    const provider = providerWith([])
    assert.equal(provider.available(), false)
    await assert.rejects(provider.search({ query: 'q' }), (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_CREDENTIAL_MISSING')
      return true
    })
  })
})

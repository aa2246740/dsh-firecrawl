# dsh-web-search-firecrawl

Firecrawl-backed search for the DeepSeek Harness `web_search` tool, with a
**multi-account load-balanced pool**. This is the escape hatch from the bundled
DeepSeek search (which only accepts the DeepSeek API key): bring your own
Firecrawl API keys and spread searches across them.

## What it does

- Registers a `WebSearchProvider` (`id: firecrawl`) on the `ctx.web` seam, so
  the model-facing `web_search` tool can run through Firecrawl's `/v1/search`
  endpoint instead of DeepSeek's.
- Pool scheduling across any number of Firecrawl API keys:
  - `round-robin` (default) — even rotation over healthy accounts;
  - `least-loaded` — always pick the account that served fewest searches.
- Automatic failover: a `429` (rate limit) or `5xx` fails the request over to
  the next healthy account and cools the exhausted one down (default 60s)
  before it is eligible again. Non-retryable `4xx` (bad key, bad request)
  fails fast with the account named.
- A **Firecrawl search** card in Settings → Plugins → Plugin configuration to
  add/remove accounts (label + key), tune strategy, max results, and cooldown —
  no config files to hand-edit.

## Setup

Clone this repository and build it using the Development instructions below.
The build requires a compatible Harness checkout with DSHX installed; set
`DSHX_HARNESS` to that checkout (and ensure any `~/.config/dshx/harness` entry
agrees). Ask DSHX to check and install the local plugin into your existing Web
profile, selecting the Host you actually use. The package name remains
`dsh-web-search-firecrawl`; this is an unofficial external plugin, not bundled
with Harness. Do not launch a second Host against the same DSH home.

1. Activate the plugin (see below), then open the WebUI:
   Settings → Plugins → Plugin configuration → **Firecrawl search**.
2. Add at least one account with a Firecrawl API key (`fc-...` from
   [firecrawl.dev](https://firecrawl.dev)), then click **保存**. Keys never echo
   back; leaving the key field blank preserves the existing key when renaming.
   An unfinished account without a key does not participate in searches.
3. Ask your external DSHX supervisor to select the existing Host and configure
   its watched profile patch (merge with an existing `web` override if present):

   ```yaml
   - id: web
     config:
       searchProvider: firecrawl
   ```

   This routing change is hot configuration, not a reason to start another Host.
   The bundled explicit `web.searchProvider` wins over `DSH_WEB_SEARCH_PROVIDER`;
   an environment variable alone does not override it. Use a new session with
   a model route that exposes `web_search`; some native-search routes hide it.

## RC1 settings migration

Targets Harness **0.1.2-rc.1**. On activation the Host migrates legacy per-account
keys into a secret dictionary keyed by account ID; account metadata contains
only IDs and labels. Existing dictionary values take precedence. The client
uses revision-checked, path-addressed mutations so editing one account cannot
erase another account's redacted key. Already lost keys cannot be recovered by
this migration and must be entered again.

Updating the Host implementation needs the DSHX `server` activation plan;
artifact synchronization alone does not activate it. Do not start a second Host
against the same DSH home.

## Development

```sh
pnpm install --ignore-workspace
pnpm build     # Host ESM lib/*.js + browser lazy-CJS lib/client.js
pnpm test      # build + actual settings/migration and pool regression tests
dshx check dsh-web-search-firecrawl
```

Local headless UI acceptance (requires the operator's pinned Codex Playwright
runtime): `node scripts/ui-acceptance.mjs`. It uses fixture keys and checks
typing, explicit save, no secret echo, and account removal preservation. Neither
mocked fetch tests nor this UI fixture proves a real Firecrawl request; complete
that acceptance in the selected running DSH Host.

`src/provider.ts` owns the pool; `src/dsh-web-search-firecrawl.ts` is the Host
entry (`ctx.web.registerSearchProvider` + settings section); `src/client/` is
the settings card (React only, no cross-plugin value imports).

## License

MIT. Firecrawl service access requires your own account and is subject to its
service terms. Never commit API keys or your DSH home/profile to this repository.

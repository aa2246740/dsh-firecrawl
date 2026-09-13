import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
//#region lib/types/accounts.js
/** Storage boundary: an unfinished account is not a usable credential. */
function resolvedAccounts(config) {
	return (config.accounts ?? []).flatMap((account) => {
		const apiKey = config.apiKeys?.[account.id] ?? account.apiKey;
		return typeof apiKey === "string" && apiKey.trim().length > 0 ? [{
			id: account.id,
			label: account.label,
			apiKey
		}] : [];
	});
}
/** One atomic owner-side migration, never reconstructed from a redacted view. */
function legacyAccountMigration(config) {
	if (!(config.accounts ?? []).some((account) => account.apiKey !== void 0)) return void 0;
	const apiKeys = { ...config.apiKeys };
	return {
		accounts: (config.accounts ?? []).map(({ id, label, apiKey }) => {
			if (!Object.hasOwn(apiKeys, id) && typeof apiKey === "string" && apiKey.trim()) apiKeys[id] = apiKey;
			return {
				id,
				label
			};
		}),
		apiKeys
	};
}
//#endregion
//#region lib/types/provider.js
/**
* Firecrawl-backed `WebSearchProvider` with a multi-account load-balanced pool.
*
* Firecrawl (`https://firecrawl.dev`) exposes a simple REST `/v1/search`
* endpoint: POST `{ query, limit, ... }` with `Authorization: Bearer <key>`.
* Each API key is rate-limited independently, so a user with several keys can
* pool them. This provider spreads searches across the pool, fails a request
* over to another healthy account on a rate-limit (`429`) or transient server
* error (`5xx`), and cools an exhausted account down for a short window before
* it is eligible again. `available()` is cheap and makes no network calls.
*
* The wire format and native `fetch` client are provider-private and do not use
* `ctx.llm`.
*
* @module dsh-web-search-firecrawl/provider
*/
/** Stable id this provider registers under (`ctx.web.registerSearchProvider`). */
const FIRECRAWL_PROVIDER_ID = "firecrawl";
/** Default Firecrawl API base; `/v1/search` is the operation. */
const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev";
/** Default maximum search results per request. */
const FIRECRAWL_DEFAULT_LIMIT = 5;
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "deepseek-harness/0.0.1";
/**
* Map one structured Firecrawl search item to a normalized source. Blank
* fields are omitted rather than set empty; a URL is required.
*/
function mapFirecrawlItem(item) {
	if (item.url == null || item.url.length === 0) return void 0;
	return {
		url: item.url,
		...item.title != null && item.title.length > 0 ? { title: item.title } : {},
		...item.description != null && item.description.length > 0 ? { snippet: item.description } : {},
		...item.publishedAt != null && item.publishedAt.length > 0 ? { publishedAt: item.publishedAt } : {}
	};
}
/**
* Map a Firecrawl `/v1/search` response to a normalized search result. `data[]`
* is deduped by URL (Firecrawl may surface the same page more than once across
* engines). The web service owns the final `maxResults` truncation, so
* `truncated` is always `false` here.
*
* @param response - the parsed Firecrawl response body.
* @returns the normalized result with deduped sources.
*/
function mapFirecrawlResponse(response) {
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const item of response.data ?? []) {
		const source = mapFirecrawlItem(item);
		if (source === void 0 || seen.has(source.url)) continue;
		seen.add(source.url);
		sources.push(source);
	}
	return {
		sources,
		truncated: false
	};
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/** True for a request limit that can be sent to Firecrawl (a positive whole number). */
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
	return new WebError("Firecrawl search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}
/** Race a same-process asynchronous preflight against caller cancellation. */
function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}
/** Add endpoint/account recovery instructions to a provider failure. */
function searchEndpointError(message, cause) {
	return new WebError(`${message}\n\nThis came from the Firecrawl search provider. Check the accounts in Settings > Plugins > Plugin configuration > Firecrawl search: each saved account needs a valid Firecrawl API key, and rate-limited accounts are cooled down automatically before they are reused. Only the user should change or choose which account serves a search.`, "WEB_PROVIDER_ERROR", cause === void 0 ? void 0 : { cause });
}
/**
* The Firecrawl-backed search provider. Spreads work across a pool of accounts,
* failing a rate-limited or server-erroring account over to the next healthy
* one and cooling the exhausted account down for {@link FirecrawlSearchProviderOptions.cooldownMs}.
*/
var FirecrawlSearchProvider = class {
	resolveOptions;
	id = FIRECRAWL_PROVIDER_ID;
	slots = [];
	next = 0;
	/**
	* @param resolveOptions - the options for the NEXT operation, snapshotted
	* once at each operation's entry so one search never mixes two settings
	* sections. A thunk rather than a value because the settings section can
	* change between searches, and re-registering the provider to carry a new
	* account pool would make the seam's selection observable as a flicker.
	*/
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	/** Cheap local usability check; makes no network calls. */
	available() {
		const options = this.resolveOptions();
		return options.accounts.some((account) => account.apiKey.length > 0) && URL.canParse(options.baseURL) && isPositiveInteger(options.limit) && Number.isInteger(options.cooldownMs) && options.cooldownMs >= 0;
	}
	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfSearchAborted(signal);
		const slots = this.syncSlots(options);
		if (slots.length === 0) throw new WebError("Firecrawl search has no accounts configured; add at least one Firecrawl API key through Settings > Plugins > Plugin configuration > Firecrawl search, or set the dsh-web-search-firecrawl config", "WEB_PROVIDER_CREDENTIAL_MISSING");
		const endpoint = `${options.baseURL}/v1/search`;
		const body = {
			query: request.query,
			...request.maxResults !== void 0 ? { limit: Math.min(request.maxResults, options.limit) } : { limit: options.limit }
		};
		const ordered = this.orderCandidates(slots, options.strategy);
		const attempts = [];
		let lastError;
		for (const account of ordered) {
			throwIfSearchAborted(signal);
			let response;
			try {
				response = await abortable(fetch(endpoint, {
					method: "POST",
					redirect: "error",
					headers: {
						"authorization": `Bearer ${account.account.apiKey}`,
						"content-type": "application/json",
						"accept": "application/json",
						"user-agent": USER_AGENT
					},
					body: JSON.stringify(body),
					...signal !== void 0 ? { signal } : {}
				}), signal);
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
				lastError = error;
				account.lastStatus = 0;
				account.uses += 1;
				this.startCooldown(account, options.cooldownMs);
				continue;
			}
			account.lastStatus = response.status;
			account.uses += 1;
			if (response.ok) try {
				return mapFirecrawlResponse(await response.json());
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
				throw searchEndpointError(error instanceof WebError ? error.message : `Firecrawl returned an unprocessable response body: ${String(error)}`, error);
			}
			attempts.push({
				response,
				account,
				endpoint
			});
			if (response.status === 429 || response.status >= 500) {
				this.startCooldown(account, options.cooldownMs);
				continue;
			}
			const message = await this.errorMessage(response, signal);
			throw searchEndpointError(`Firecrawl API error (HTTP ${response.status}) for account "${this.label(account.account)}"${message.length > 0 ? `: ${message}` : ""}`);
		}
		if (attempts.length === 0) throw searchEndpointError(`Firecrawl search request failed: ${String(lastError ?? "no accounts could be reached")}`, lastError);
		const last = attempts[attempts.length - 1];
		const message = await this.errorMessage(last.response, signal);
		throw searchEndpointError(`Firecrawl search failed after trying ${attempts.length} account(s); last attempt was HTTP ${last.response.status}${message.length > 0 ? `: ${message}` : ""}`);
	}
	/** Reconcile the persistent slot table with the latest snapshot's accounts. */
	syncSlots(options) {
		const byId = new Map(this.slots.map((slot) => [slot.account.id, slot]));
		this.slots = options.accounts.map((account) => {
			const existing = byId.get(account.id);
			if (existing !== void 0) {
				existing.account = account;
				return existing;
			}
			return {
				account,
				uses: 0,
				cooledUntil: 0,
				lastStatus: 0
			};
		});
		return this.slots;
	}
	/**
	* Order candidate accounts for this operation: healthy ones first (in
	* strategy order), then cooling-down ones, so a small exhausted pool still
	* degrades gracefully.
	*/
	orderCandidates(slots, strategy) {
		const now = Date.now();
		const healthy = slots.filter((slot) => slot.cooledUntil <= now);
		const cooling = slots.filter((slot) => slot.cooledUntil > now);
		if (strategy === "least-loaded") {
			healthy.sort((a, b) => a.uses - b.uses);
			cooling.sort((a, b) => a.uses - b.uses);
		} else if (healthy.length > 0) {
			this.next = this.next % healthy.length;
			const rotated = healthy.slice(this.next).concat(healthy.slice(0, this.next));
			this.next = (this.next + 1) % healthy.length;
			return rotated.concat(cooling);
		}
		return healthy.concat(cooling);
	}
	/** Put one account in cooldown (or extend an existing cooldown) for `cooldownMs`. */
	startCooldown(slot, cooldownMs) {
		const until = Date.now() + cooldownMs;
		slot.cooledUntil = Math.max(slot.cooledUntil, until);
	}
	label(account) {
		return account.label !== void 0 && account.label.length > 0 ? account.label : account.id;
	}
	/** Extract a human-readable message from a non-ok error body, honoring abort. */
	async errorMessage(response, signal) {
		try {
			const parsed = await response.json();
			return parsed.error ?? parsed.message ?? "";
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			return "";
		}
	}
};
//#endregion
//#region lib/types/dsh-web-search-firecrawl.js
/**
* Firecrawl-backed search provider for the DeepSeek Harness web capability
* seam (`ctx.web`). Unlike the bundled DeepSeek search, which only accepts the
* DeepSeek API key, this plugin lets the user bring their own Firecrawl
* account(s) and load-balances across a pool of Firecrawl API keys.
*
* Two halves, one package:
* - Host half (this file): registers the {@link FirecrawlSearchProvider} on
*   `ctx.web` and a `settings` section so accounts are manageable.
* - Browser half (`src/client/`): a `settings.plugin.item` card that adds,
*   edits, and removes accounts and tunes pool behavior.
*
* @module dsh-web-search-firecrawl
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "dsh-web-search-firecrawl";
/** The web seam this provider registers into. */
const inject = ["web"];
/** Default cooldown for a rate-limited account (one minute). */
const DEFAULT_COOLDOWN_MS = 6e4;
/** Settings namespace carrying this provider's accounts and pool options. */
const FIRECRAWL_SETTINGS_NAMESPACE = "dsh-web-search-firecrawl";
const Config = z.object({
	accounts: z.array(z.object({
		id: z.string(),
		label: z.string(),
		apiKey: z.string().role("secret")
	})),
	apiKeys: z.dict(z.string().role("secret")),
	baseURL: z.string(),
	limit: z.number().step(1).min(1),
	strategy: z.union(["round-robin", "least-loaded"]),
	cooldownMs: z.number().step(1).min(0)
});
/** Project one resolved section into the options the provider serves next. */
function resolveOptions(config) {
	return {
		accounts: resolvedAccounts(config),
		baseURL: config.baseURL ?? "https://api.firecrawl.dev",
		limit: config.limit ?? 5,
		strategy: config.strategy ?? "round-robin",
		cooldownMs: config.cooldownMs ?? DEFAULT_COOLDOWN_MS
	};
}
/** Register the Firecrawl search provider with `ctx.web` and its settings section. */
function apply(ctx, config) {
	console.log("[my-plugins/dsh-web-search-firecrawl] loaded");
	let current = () => config;
	ctx.inject(["settings"], async (settingsCtx) => {
		const scope = settingsCtx.settings.register(FIRECRAWL_SETTINGS_NAMESPACE, Config, { base: config });
		const migration = legacyAccountMigration(scope.get());
		if (migration !== void 0) await scope.update(migration);
		current = () => scope.get();
	});
	ctx.web.registerSearchProvider(new FirecrawlSearchProvider(() => resolveOptions(current())));
}
//#endregion
export { Config, FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_DEFAULT_LIMIT, FIRECRAWL_PROVIDER_ID, FIRECRAWL_SETTINGS_NAMESPACE, FirecrawlSearchProvider, apply, inject, name };

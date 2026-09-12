window.__ModuleLoader__.load({
	id: "dsh-web-search-firecrawl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/accounts.ts
		/** Wire-safe metadata projection; never repeat any credential in an array write. */
		function metadataOnly(accounts) {
			return accounts.map(({ id, label }) => ({
				id,
				label
			}));
		}
		//#endregion
		//#region src/client/accounts-controller.ts
		/** All edits use the namespace's revision fence and never read credential values. */
		var AccountsController = class {
			scope;
			constructor(scope) {
				this.scope = scope;
			}
			snapshot() {
				const snapshot = this.scope.getSnapshot();
				if (snapshot.status !== "ready" || !snapshot.writable) throw new Error("Settings are not writable");
				return {
					accounts: metadataOnly(snapshot.value?.accounts ?? []),
					revision: snapshot.revision
				};
			}
			add(id) {
				const { accounts, revision } = this.snapshot();
				return this.scope.mutate([{
					op: "set",
					path: ["accounts"],
					value: [...accounts, {
						id,
						label: ""
					}]
				}], revision);
			}
			save(id, label, key) {
				const { accounts, revision } = this.snapshot();
				if (!accounts.some((account) => account.id === id)) throw new Error("Account was removed");
				const ops = [{
					op: "set",
					path: ["accounts"],
					value: accounts.map((account) => account.id === id ? {
						id,
						label
					} : account)
				}];
				if (key.trim()) ops.push({
					op: "set",
					path: ["apiKeys", id],
					value: key.trim()
				});
				return this.scope.mutate(ops, revision);
			}
			remove(id) {
				const { accounts, revision } = this.snapshot();
				return this.scope.mutate([{
					op: "set",
					path: ["accounts"],
					value: accounts.filter((account) => account.id !== id)
				}, {
					op: "unset",
					path: ["apiKeys", id]
				}], revision);
			}
		};
		//#endregion
		//#region src/client/index.tsx
		const NAMESPACE = "dsh-web-search-firecrawl";
		const name = "dsh-web-search-firecrawl-client";
		const inject = [
			"slots",
			"settingsScope",
			"remote",
			"remote.settings"
		];
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
			const accounts = new AccountsController(scope);
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NAMESPACE
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FirecrawlCard, {
				scope,
				accounts,
				ctx
			})));
		}
		const inputStyle = {
			padding: "6px 8px",
			border: "1px solid #8886",
			borderRadius: 6,
			background: "transparent",
			color: "inherit"
		};
		const buttonStyle = {
			...inputStyle,
			cursor: "pointer"
		};
		function AccountRow({ account, configured, busy, save, remove }) {
			const [label, setLabel] = (0, react.useState)(account.label);
			const [key, setKey] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				setLabel(account.label);
			}, [account.label]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
				style: {
					border: "1px solid #8884",
					borderRadius: 6,
					padding: 10,
					marginTop: 10
				},
				disabled: busy,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: account.label || "新账号" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						gap: 8,
						flexWrap: "wrap",
						alignItems: "end"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "grid",
								gap: 4
							},
							children: ["名称", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								"aria-label": "账号名称",
								style: inputStyle,
								value: label,
								onChange: (event) => setLabel(event.target.value)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "grid",
								gap: 4
							},
							children: [
								"API key · ",
								configured === void 0 ? "状态待确认" : configured ? "已配置" : "未配置",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"aria-label": "Firecrawl API key",
									style: inputStyle,
									type: "password",
									autoComplete: "off",
									value: key,
									placeholder: configured ? "留空保留已有 key" : "fc-...",
									onChange: (event) => setKey(event.target.value)
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: buttonStyle,
							onClick: () => {
								save(label, key).then(() => setKey("")).catch(() => {});
							},
							children: "保存"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: buttonStyle,
							onClick: remove,
							children: "移除账号"
						})
					]
				})]
			});
		}
		function FirecrawlCard({ scope, accounts: controller, ctx }) {
			const snapshot = (0, react.useSyncExternalStore)(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope));
			const [open, setOpen] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [configured, setConfigured] = (0, react.useState)();
			(0, react.useEffect)(() => {
				let current = true;
				setConfigured(void 0);
				ctx.remote.settings.describe().then((result) => {
					if (!current || !result.ok) return;
					const ns = result.value.namespaces.find((item) => item.ns === NAMESPACE);
					if (ns) setConfigured(Object.fromEntries(ns.secrets.filter((secret) => secret.path[0] === "apiKeys").map((secret) => [secret.path[1], secret.set])));
				}).catch(() => {});
				return () => {
					current = false;
				};
			}, [snapshot.revision, ctx]);
			if (snapshot.status !== "ready") return null;
			const section = snapshot.value ?? {};
			async function run(action) {
				setBusy(true);
				setError("");
				try {
					await action();
				} catch (error) {
					setError("保存失败，未确认写入。请重新打开设置后重试。");
					throw error;
				} finally {
					setBusy(false);
				}
			}
			function act(action) {
				run(action).catch(() => {});
			}
			const disabled = busy || !snapshot.writable;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: {
					listStyle: "none",
					border: "1px solid #8884",
					borderRadius: 8,
					margin: "8px 0"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					style: {
						...buttonStyle,
						border: 0,
						width: "100%",
						textAlign: "left",
						padding: 14
					},
					"aria-expanded": open,
					onClick: () => setOpen(!open),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Firecrawl search" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							opacity: .7,
							fontSize: 12
						},
						children: ["搜索账号与负载均衡 · ", open ? "收起" : "展开"]
					})]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { padding: "0 14px 14px" },
					children: [
						(section.accounts ?? []).map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountRow, {
							account,
							configured: configured === void 0 ? void 0 : configured[account.id] === true,
							busy: disabled,
							save: (label, key) => run(() => controller.save(account.id, label, key)),
							remove: () => act(() => controller.remove(account.id))
						}, account.id)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: {
								...buttonStyle,
								marginTop: 10
							},
							disabled,
							onClick: () => act(() => controller.add(crypto.randomUUID())),
							children: "添加账号"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								fontSize: 12,
								opacity: .75
							},
							children: "Key 只写入、不回显。填写后点“保存”；只改名称不会清除已有 key。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
							disabled,
							style: {
								border: 0,
								padding: 0,
								display: "flex",
								gap: 12,
								flexWrap: "wrap"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["策略 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": "账号策略",
									style: inputStyle,
									value: section.strategy ?? "round-robin",
									onChange: (event) => act(() => scope.set("strategy", event.target.value)),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "round-robin",
										children: "轮询"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "least-loaded",
										children: "最少使用"
									})]
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["结果数 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"aria-label": "搜索结果数",
									style: {
										...inputStyle,
										width: 65
									},
									type: "number",
									min: 1,
									defaultValue: section.limit ?? 5,
									onBlur: (event) => {
										const value = Number(event.target.value);
										if (Number.isInteger(value) && value > 0) act(() => scope.set("limit", value));
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["冷却毫秒 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"aria-label": "冷却毫秒",
									style: {
										...inputStyle,
										width: 90
									},
									type: "number",
									min: 0,
									defaultValue: section.cooldownMs ?? 6e4,
									onBlur: (event) => {
										const value = Number(event.target.value);
										if (Number.isInteger(value) && value >= 0) act(() => scope.set("cooldownMs", value));
									}
								})] })
							]
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: {
								fontSize: 12,
								opacity: .75
							},
							children: [
								"这个 bundle 会把 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "web.searchProvider" }),
								" 设为 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "firecrawl" }),
								"。加好账号后，用会暴露 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "web_search" }),
								" 的新会话。"
							]
						})
					]
				})]
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
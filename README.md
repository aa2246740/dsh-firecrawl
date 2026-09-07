# dsh-web-search-firecrawl

给 DeepSeek Harness 的 `web_search` 换 Firecrawl，并带多账号池。包名仍是 `dsh-web-search-firecrawl`。仓库是 `dsh-firecrawl`。

在 `ctx.web` 上注册 `id: firecrawl` 的 `WebSearchProvider`，走 Firecrawl `/v1/search`。调度默认 `round-robin`，也可 `least-loaded`。`429` 或 `5xx` 切到下一个健康账号，默认冷却 60 秒。不可重试的 `4xx` 立刻失败并点名那个账号。

设置在 Settings → Plugins → Plugin configuration → **Firecrawl search**。

## 安装

对着一份装了 DSHX 的 Harness 检出构建。`DSHX_HARNESS` 要指向那份检出。

```sh
pnpm install --ignore-workspace
pnpm build
pnpm test
dshx check dsh-web-search-firecrawl
```

然后让 DSHX 把本地插件装进你正在用的 Web profile，选中实际那个 Host。不要对同一个 DSH home 再起第二个 Host。

1. 打开 WebUI：Settings → Plugins → Plugin configuration → **Firecrawl search**。
2. 加至少一个 Firecrawl API key（[firecrawl.dev](https://firecrawl.dev) 的 `fc-...`），点 **保存**。密钥不会回显。改名时 key 留空表示保留原 key。
3. 在现有 Host 的 watched profile patch 里写（已有 `web` override 就合并进去）：

```yaml
- id: web
  config:
    searchProvider: firecrawl
```

这是热配置，不是再起一个 Host 的理由。bundled 的显式 `web.searchProvider` 优先于 `DSH_WEB_SEARCH_PROVIDER`。用会暴露 `web_search` 的新会话。

面向 Harness **0.1.2-rc.1**。激活时会把旧的按账号密钥迁进按账号 ID 索引的 secret dictionary。改 Host 实现要用 DSHX `server` activation plan，只同步产物不够。

## 许可

MIT。Firecrawl 服务用你自己的账号，遵守它的条款。不要把 API key 或 DSH home/profile 提交进这个仓库。

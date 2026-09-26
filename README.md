# dsh-web-search-firecrawl

## 安装

### DSH Studio 桌面 App（推荐）

打开 **设置 → 插件 → 添加插件**，在“包名或地址”中输入：

```text
github:aa2246740/dsh-firecrawl#v0.1.3
```

桌面端插件管理器负责 Desktop profile 和内置包管理器。本发布已包含编译好的 `lib/`；普通使用不需要 clone 或本地构建。若应用提示刷新或重新打开，请按提示完成。

### Web CLI

```sh
dsh plugin --profile web add github:aa2246740/dsh-firecrawl#v0.1.3
```

这条官方 CLI 命令只写入 `web` profile，不能修改 Desktop App 的 profile。对于已经运行的 Web Host，请重新打开该 Host 一次，再刷新网页。

给 DeepSeek Harness 的 `web_search` 换 Firecrawl，并带多账号池。包名仍是 `dsh-web-search-firecrawl`。仓库是 `dsh-firecrawl`。

在 `ctx.web` 上注册 `id: firecrawl` 的 `WebSearchProvider`，走 Firecrawl `/v1/search`。调度默认 `round-robin`，也可 `least-loaded`。`429` 或 `5xx` 切到下一个健康账号，默认冷却 60 秒。不可重试的 `4xx` 立刻失败并点名那个账号。

这个 bundle 会把官方 `web.searchProvider` 设成 `firecrawl`，并保留 `fetchProvider: http`。账号在侧栏 **插件** 里打开已安装的 `dsh-web-search-firecrawl`，再点该行的 **配置**。

面向官方 DeepSeek Harness **0.1.7-rc.2**。Peer 范围仍是 `>=0.1.7-rc.1 <0.1.8`，因此接受 `0.1.7-rc.2`，拒绝 `0.1.7` alpha。

## 其它装法（开发/本地测试）

本地目录或 tarball：

```sh
dsh plugin --profile web add ./dsh-firecrawl
dsh plugin --profile web add ./dsh-web-search-firecrawl-0.1.3.tgz
```

`dsh.bundle` 是开机捕获的。不要再往 profile 的 `cordis.patch.yml` 手写同一条 insert，会重复挂载。

```sh
dsh plugin --profile web remove dsh-web-search-firecrawl
```

## 使用

1. 打开 WebUI 侧栏 **插件**，进入 `dsh-web-search-firecrawl`，点 **配置**。
2. 加至少一个 Firecrawl API key（[firecrawl.dev](https://firecrawl.dev) 的 `fc-...`），点 **保存**。密钥不会回显。改名时 key 留空表示保留原 key。
3. 用会暴露 `web_search` 的新会话。

激活时会把旧的按账号密钥迁进按账号 ID 索引的 secret dictionary。

## 许可

MIT。Firecrawl 服务用你自己的账号，遵守它的条款。不要把 API key 或 DSH home/profile 提交进这个仓库。

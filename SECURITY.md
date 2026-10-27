# 安全模型 / Security model

This document states what **dsh-mp-catalog-guard** trusts, which inputs it treats as
untrusted, what it writes, and where the trust boundary is. Everything below was read
from the implementation (`src/host.js`, `src/check.js`, `src/io.js`, `src/assets.js`,
`src/render.js`, `src/fix.js`, `src/panel-html.js`, `src/client.cjs`, `src/cli.js`).
**If this document and the code disagree, the code is right and this document is a bug.**

> 一句话：这是一个**本地静态检查器**，信任边界画在「谁能调用 DSH 的 web server / 谁能调用工具」
> 上，而不是画在项目目录上。给它一个路径，它就会读那个路径；`apply: true` 时它会把
> `catalog.json` 整个写回去。它不联网、不开端口、不删文件。

## 信任边界

插件跑在 DSH 宿主进程里，有两个对外表面：

| 表面 | 谁在用 | 鉴权 |
| --- | --- | --- |
| `mp_catalog_guard` 工具（`src/host.js` 的 `ctx.tools.register`） | 当前会话里的 agent | 没有插件自己的 token；能调用工具就能调用它 |
| `/dsh-mp-catalog-guard` 路由（`ctx.webServer.register`，`kind: 'prefix'`） | 本机浏览器里的「内容目录」面板 | **插件不鉴权**，完全依赖 DSH web server 自己的访问控制 |

它**不开监听端口**：HTTP 面只是挂在 DSH 已有的 web server 前缀上。面板客户端只发
`/state`、`/rescan`、`/apply` 三种请求（`src/client.cjs`）。

读哪些文件：

- `projectDir/catalog.json`（可配置，`src/check.js` 的 `catalogPath`）；
- `projectDir` 下的 `pages/**/*.wxml`、`components/**/*.wxml`、`templates/**/*.wxml`、
  `pages/**/*.js`、`components/**/*.js`、`utils/**/*.js`（`src/render.js` 的
  `DEFAULT_SCAN_PATTERNS`），上限 400 个文件、单文件 512 KiB；
- 图片**只判断存在性**（`existsSync`），不打开、不读内容、不下载（`src/assets.js` +
  `src/check.js` 的 `imageExists`）。

写哪些文件：

- 只有 `apply: true`（工具参数或 `POST /apply`）才写，且只写 `catalog.json` 一个文件
  （`src/check.js` 的 `if (mode === 'apply')`）；写回时保留原缩进 / 行尾 / 结尾换行
  （`src/fix.js` 的 `serializeCatalog`）。
- 面板状态写到 `$DSH_HOME/mp-catalog-guard/state.json`（或配置的 `dataDir`），里面是
  计数、最近一次报告（diff 截断到 200 000 字符）、20 条历史和绝对 `projectDir`。
- CLI 只有显式传 `--report <文件>` 时才额外写一份 HTML。

## 不可信输入

- **模型给的参数**：`projectDir`、`catalog`、`apply`、`render`、`requiredFields`。它们直接
  决定读哪个文件、写哪个文件；`catalog` 允许绝对路径，`projectDir` 相对 `baseDir` 解析
  （`src/host.js` 的 `resolveProjectDir`、`src/check.js` 的 `catalogPath`）。
- **HTTP 请求**：`/dsh-mp-catalog-guard` 下的所有请求。请求体超过 1 MiB 直接
  `req.destroy()`（`src/host.js` 的 `readBody`）；JSON 解析失败当作 `{}`。`POST /rescan` 与
  `POST /apply` 不读请求体里的任何字段，直接用持久化的 `lastProjectDir` 重跑。
- **项目里的文本**：`catalog.json` 的标题 / 副标题 / id、wxml/js 的整行内容、图片路径。
  它们只作为**数据**进入报告，渲染进 HTML 时全部经过 `escapeHtml`（`src/panel-html.js`
  的 `escapeHtml`，每个插值点都调用）；面板用 `dangerouslySetInnerHTML` 注入这份
  host 生成的 HTML（`src/client.cjs`），安全性完全依赖那一个转义函数；静态报告页不含任何
  `<script>`。
- **图片字段**：`image` 只是字符串。`..` 只记 `image-outside` 警告、不阻断；`http(s)://`、
  `cloud://` 等远程地址只记信息级问题，**不会去 fetch**。

## 鉴权 / 权限现状（照实写）

- **工具没有 token**：任何能调用 `mp_catalog_guard` 的 agent 都能读任意 `projectDir`、
  以 `apply: true` 改写 `catalog.json`。这是工具类插件的正常权限模型，不是本插件的门禁。
- **HTTP 路由没有任何自己的鉴权**：`GET /state`、`GET /report.html`、`POST /rescan`、
  `POST /apply` 都不检查 header、token 或 Origin；代码里没有 CSRF 校验，也没有会话绑定。
  **`POST /apply` 是会写盘的**，而且写的是上一次检查的目录（状态文件里的
  `lastProjectDir`）。因此「能访问 DSH web server 的本机页面/插件」就能触发一次写回；
  宿主是否另做会话校验取决于 DSH 版本，本插件不重复实现，也不依赖它做安全边界。
- **不是「看起来像门禁」的东西**：面板上的「应用修复」按钮只是 UI，路由不校验点击来源；
  `apply` 参数也没有二次确认。

## 数据与副作用

- **不联网**：`src/` 里没有 `fetch`、`http`、`https` 或模型调用；唯一的网络行为是宿主
  本身。
- **不删文件、不改运行逻辑**：没有 `unlink` / `rm`；`apply` 只替换 `catalog.json` 的内容。
- **写盘两套路径**：只有目录文件的 `readText` / `writeText` 优先走 `ctx.fs`（`src/host.js` 的
  `io`），文件系统策略由宿主决定；图片存在性（`existsSync`）、源码扫描
  （`collectSourceFiles`）和 `state.json` 的读写 / `mkdir` 都直接用 `node:fs`，**不经过
  `ctx.fs`**——把 `dataDir` 指到不允许写的目录时，状态会静默丢失，不会影响检查结果。
- **不收集遥测**、不上传目录内容、不带账号信息。`state.json` 里会保留项目绝对路径与最近
  一次 diff，属于本机状态，删掉它即可清空面板记忆。

## 已知限制（真实取舍，不是「待办」）

1. **路径不受限**：`projectDir` 与 `catalog` 可以是任意绝对路径；`image` 里的 `..` 只报告
   不拦截。它检查的是「你指给它的项目」，不是一个被沙箱圈定的目录。
2. **符号链接处理不一致**：源码扫描用 `readdirSync(..., { withFileTypes: true })`，只处理
   `isDirectory()` / `isFile()` 条目（`src/render.js`），因此**指向文件的符号链接会被跳过**；
   图片存在性用 `existsSync`，会跟随符号链接。指向目录的链接同理不会被递归。
3. **`apply` 不是事务**：先读、再按旧文本规划修复、再整文件写回（`src/check.js`）。两次
   调用并发、或你在检查期间手改了文件，后写的一方会覆盖前者。
4. **检测是逐行正则，不是 WXML/JS 解析**（`src/render.js` 的 `scanRenders`）：一行最多报
   一条，注释行跳过；跨行表达式、自定义模板函数可能漏报，也可能误报。
5. **扫描有硬上限**：400 个文件、单文件 512 KiB、diff 的 LCS 超过 4 000 000 格时退化为
   「整段替换」（`src/fix.js` 的 `lcsOps`）。大仓库会有文件没扫到，报告里会注明达到上限。
6. **HTTP 面没有限速**：任何能访问路由的调用方都可以反复触发全量扫描（CPU/磁盘），
   或反复 `POST /apply`。这是本地开发工具的取舍，没有并发上限。
7. **远程图片不校验**：离线环境无法确认 CDN 图片是否还在（`image-remote` 只是信息级）。
8. **旧金额字段按「元」解释是约定**，可用 `legacyAmountIsYuan: false` 关闭换算；这是产品
   约定，不是事实推断。
9. **没有审计日志**：`state.json` 只保留 20 条历史并被覆盖，`apply` 不记录「谁改的」。

## 明确不算漏洞的

- `apply: true` 改写 `catalog.json`——这是插件的核心功能，且默认 dry-run、只改三类有唯一
  正确写法的字段（`src/fix.js` 的 `planFixes`）。
- `amount` / `price` 被当作「元」×100——这是声明过的约定，配置可关。
- 报告里出现绝对路径——项目外的文件刻意显示绝对路径（`src/check.js` 的 `displayPath`），
  否则位置就是假的。
- 目录里的标题、副标题、路径里带 `<script>` 导致 XSS——所有插值都转义，报告页无脚本；
  面板只注入 host 生成的转义后 HTML。
- 有人把 `projectDir` 指向自己的其他项目——它本来就是本地检查器，不是权限边界。
- `state.json` 被本机用户读取或改写——同一用户对自己的 home 目录本来就有这个权限。

## 报告漏洞

用 GitHub 的私密渠道：
<https://github.com/dingchenhui0618-arch/dsh-mp-catalog-guard/security/advisories/new>

这是个人项目，**不承诺响应时限**；会读、会修，修完写进 `CHANGELOG.md` 并说明影响范围。
请不要把仍在生效的问题先发到公开 issue。

## 支持范围

只维护**最新一版**（`main` 上的 `0.1.x`）。这个包**尚未发布到 npm**，因此没有版本化的
支持窗口；从 GitHub 源或本地目录安装的都是开发版，升级到最新 `main` 即可。更早的提交
不再单独回补。

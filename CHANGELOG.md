# Changelog

## [Unreleased]

### 文档与工程

- 新增 `SECURITY.md`：信任边界、不可信输入、鉴权现状、已知限制与漏洞报告渠道。
- CI（`.github/workflows/ci.yml`）已覆盖 build、`lib/` 一致性与单测，这里只做核对，没有改语义。
- README 顶部加 CI / license badge 与 star 引导。

## 0.1.0 — 2026-10-22

首个版本。范围：微信小程序内容目录（`catalog.json`）的静态校验 + 可直接应用的修复 diff。

- 29 条规则，分目录结构、必填/唯一性、金额、渲染、图片五组，严重级只在 `src/rules.js` 定义一次。
- 金额契约：`amountFen` 必须是整数分；拒绝浮点、负数、字符串、0（告警）和 ≥1000 万（告警）；旧字段 `amount`/`price`/`fee`/`cost` 按元换算成分（可关）。
- 渲染扫描：`pages/components/templates` 的 wxml/js 里拦截 `/ 100`、`toFixed(2)`、直接渲染 `amountFen`、`¥` 裸表达式；全项目找不到 `money()` 时单独告警。
- 三条可自动修复（旧金额、字符串分、绝对图片路径），其余只报告不猜。
- 修复 diff 为 unified diff，保留原缩进 / 行尾 / 结尾换行；压缩成一行的文件会重新缩进并在报告里注明。
- 默认 dry-run；`apply` 后重新检查写回后的文件，报告描述的是剩余问题。
- 三个入口共用一份实现：`mp_catalog_guard` 工具、`内容目录` 面板（`conversation.view`，order 32）、`mp-catalog-guard` CLI（退出码 0/1/2）。
- 面板 / 自包含 HTML 报告 / `docs/` 截图共用同一个渲染函数。
- 零依赖构建（`scripts/build.mjs`），`lib/` 由 `src/` 生成，CI 校验两者同步。
- 180 个测试（`node --test`）。

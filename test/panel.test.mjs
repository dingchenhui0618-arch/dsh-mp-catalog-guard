// Panel HTML tests: the one renderer that feeds the GUI panel, the standalone
// report page and the screenshot in docs/.

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { escapeHtml, renderPanelHtml, renderReportPage } from '../src/panel-html.js'
import { assembleReport } from '../src/report.js'
import { makeIssue } from '../src/rules.js'

function build(overrides) {
  return assembleReport(Object.assign({
    projectDir: 'C:/demo',
    catalog: 'catalog.json',
    catalogPath: 'C:/demo/catalog.json',
    parsed: true,
    entries: 3,
    at: new Date('2026-10-22T02:31:01.000Z'),
    durationMs: 26,
    issues: [],
    fixes: { changes: [] },
    diff: '',
    notes: [],
    render: { checkedFiles: 2, helper: { defined: true, where: ['utils/format.js'] }, files: [] },
  }, overrides || {}))
}

const FLOAT = makeIssue('amount-fen-float', {
  file: 'catalog.json',
  line: 24,
  entry: 2,
  entryId: 'act_autumn_3',
  message: 'amountFen = 19.9，不是整数分。',
  hint: '分必须是整数；如果想要 19.90 元，这里是 1990。',
})
const MISSING = makeIssue('image-missing', {
  file: 'catalog.json',
  line: 27,
  entry: 3,
  message: '图片不存在：images/missing-snack.png',
})
const REMOTE = makeIssue('image-remote', {
  file: 'catalog.json',
  line: 40,
  entry: 5,
  message: 'image 是远程地址。',
})

const DIFF = '--- a/catalog.json\n+++ b/catalog.json\n@@ -1,2 +1,2 @@\n-  "amount": 128,\n+  "amountFen": 12800,\n'

// ---- empty and clean ------------------------------------------------------

test('before the first run the panel explains what to do and offers both buttons', function () {
  const html = renderPanelHtml(undefined)
  assert.match(html, /mc-empty/)
  assert.match(html, /还没有检查过/)
  assert.match(html, /data-action="rescan"/)
  assert.match(html, /data-action="apply"/)
  assert.match(html, /mc-verdict mc-idle/)
})

test('a clean report is a success block, not an empty list', function () {
  const html = renderPanelHtml(build())
  assert.match(html, /mc-clean/)
  assert.match(html, /没有发现问题/)
  assert.match(html, /全部通过/)
  assert.equal(html.includes('mc-sev-error'), false)
})

// ---- issues ---------------------------------------------------------------

test('issues are grouped by severity and carry rule, location and fix tag', function () {
  const html = renderPanelHtml(build({
    issues: [FLOAT, MISSING, REMOTE],
    counts: undefined,
  }))
  assert.match(html, /mc-sev-error/)
  assert.match(html, /mc-sev-info/)
  assert.match(html, /amount-fen-float/)
  assert.match(html, /catalog\.json:24/)
  assert.match(html, /可自动修复/)
  assert.match(html, /需人工/)
  assert.match(html, /分必须是整数/)
  assert.match(html, /mc-eid">act_autumn_3/)
  assert.match(html, /错误<\/span><span class="mc-count">2/)
})

test('the stat cards show the report numbers', function () {
  const html = renderPanelHtml(build({ issues: [FLOAT, MISSING, REMOTE] }))
  assert.match(html, /<b>3<\/b><span>活动/)
  assert.match(html, /<b>2<\/b><span>错误/)
  assert.match(html, /<b>0<\/b><span>警告/)
  assert.match(html, /<b>1<\/b><span>信息/)
})

test('every interpolated value is escaped', function () {
  const nasty = makeIssue('title-duplicate', {
    file: 'catalog.json',
    message: '<script>alert(1)</script> "quoted" & \'single\'',
  })
  const html = renderPanelHtml(build({ issues: [nasty] }))
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&quot;quoted&quot;/)
  assert.match(html, /&#39;single&#39;/)
})

test('escapeHtml covers the five entities', function () {
  assert.equal(escapeHtml('<&>"\''), '&lt;&amp;&gt;&quot;&#39;')
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(null), '')
})

// ---- diff -----------------------------------------------------------------

test('the diff is colour-classed line by line', function () {
  const html = renderPanelHtml(build({
    issues: [FLOAT],
    fixes: { changes: [{ rule: 'amount-legacy', entry: 1, field: 'amountFen', before: 128, after: 12800 }] },
    diff: DIFF,
  }))
  assert.match(html, /mc-dl mc-add/)
  assert.match(html, /mc-dl mc-del/)
  assert.match(html, /mc-dl mc-hh/)
  assert.match(html, /\+  &quot;amountFen&quot;: 12800,/)
  assert.match(html, /dry-run，未写入/)
  assert.match(html, /3 处|1 处/)
})

test('the apply button is enabled only when something is fixable', function () {
  const plain = renderPanelHtml(build({ issues: [MISSING] }))
  assert.match(plain, /data-action="apply" disabled/)
  const fixable = renderPanelHtml(build({
    issues: [FLOAT],
    fixes: { changes: [{ rule: 'amount-legacy', entry: 1, field: 'amountFen', before: 128, after: 12800 }] },
    diff: DIFF,
  }))
  assert.match(fixable, /data-action="apply">应用修复 · 1 处/)
  assert.equal(/data-action="apply" disabled/.test(fixable), false)
})

test('buttons are omitted when the caller renders a plain report', function () {
  const html = renderPanelHtml(build({
    issues: [FLOAT],
    fixes: { changes: [{ rule: 'amount-legacy', entry: 1, field: 'amountFen', before: 128, after: 12800 }] },
    diff: DIFF,
  }), { buttons: false })
  assert.equal(html.includes('data-action'), false)
  assert.match(html, /dry-run，未写入/)
})

test('an applied report says so instead of offering dry-run wording', function () {
  const html = renderPanelHtml(build({
    mode: 'apply',
    applied: true,
    issues: [FLOAT],
    fixes: { changes: [{ rule: 'amount-legacy', entry: 1, field: 'amountFen', before: 128, after: 12800 }] },
    diff: DIFF,
  }), { buttons: false })
  assert.match(html, /已写入/)
  assert.match(html, /已写回文件/)
})

test('notes and a write failure are both visible', function () {
  const html = renderPanelHtml(build({
    issues: [FLOAT],
    notes: ['amount / price 按元换算'],
    applyError: 'EACCES: permission denied',
  }))
  assert.match(html, /注：amount \/ price 按元换算/)
  assert.match(html, /写入失败：EACCES/)
})

test('the scan line reports the file count and the helper', function () {
  const withHelper = renderPanelHtml(build())
  assert.match(withHelper, /扫描 2 个模板/)
  assert.match(withHelper, /money\(\) 已定义/)
  const without = renderPanelHtml(build({
    render: { checkedFiles: 1, helper: { defined: false, where: [] }, files: ['pages/index.wxml'] },
    issues: [makeIssue('money-helper-missing', { message: '没找到 money()' })],
  }))
  assert.match(without, /money\(\) 未找到/)
})

// ---- the page -------------------------------------------------------------

test('the standalone page embeds the stylesheet and the panel markup', function () {
  const page = renderReportPage(build({ issues: [FLOAT], fixes: { changes: [{ rule: 'x' }] }, diff: DIFF }), {
    theme: 'dark',
    version: '0.1.0',
  })
  assert.match(page, /^<!doctype html>/)
  assert.match(page, /<body class="mc-page mc-theme-dark">/)
  assert.match(page, /\.mc-root/)
  assert.match(page, /\.mc-diff-body/)
  assert.match(page, /dsh-mp-catalog-guard 0\.1\.0/)
  assert.match(page, /mc-inner/)
  assert.equal(page.includes('data-action'), false)
})

test('panel mode adds the buttons and says they only work in the panel', function () {
  const page = renderReportPage(build({ issues: [FLOAT] }), { panel: true })
  assert.match(page, /data-action="rescan"/)
  assert.match(page, /只在 DSH 面板里可点/)
})

test('the page title names the catalog file', function () {
  const page = renderReportPage(build(), {})
  assert.match(page, /<title>内容目录检查 · catalog\.json<\/title>/)
})

test('a report page without a report is still valid HTML', function () {
  const page = renderReportPage(undefined, {})
  assert.match(page, /mc-empty/)
  assert.match(page, /<\/html>/)
})

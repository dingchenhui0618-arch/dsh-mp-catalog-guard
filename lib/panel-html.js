// The one visual implementation of the report.
//
// Both consumers render this exact markup: the conversation panel drops it into
// a React wrapper, and scripts/screenshot.mjs wraps the same string in a
// standalone document. That is the only way the screenshot in docs/ can honestly
// claim to show the panel — there is nothing else to render.
//
// Everything interpolated is escaped. The inputs are catalog contents and file
// paths, which routinely contain quotes and angle brackets.

import pluginCss from './client-css.cjs'
import { formatLocation, SEVERITY_LABEL } from './rules.js'

export function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pad(number) {
  return number < 10 ? '0' + number : String(number)
}

function clock(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}

function shortPath(value, max) {
  const text = String(value || '')
  const limit = Number.isInteger(max) ? max : 46
  if (text.length <= limit) return text
  return '…' + text.slice(text.length - limit + 1)
}

/** Last two segments, with the full path kept in the title attribute. */
function tailPath(value, segments) {
  const keep = Number.isInteger(segments) ? segments : 2
  const parts = String(value || '').split(/[\\/]+/).filter(function (part) { return part.length > 0 })
  if (parts.length === 0) return String(value || '')
  if (parts.length <= keep) return parts.join('\\')
  return '…\\' + parts.slice(parts.length - keep).join('\\')
}

function verdictOf(report) {
  if (report.counts.error > 0) return { cls: 'mc-bad', text: '有错误' }
  if (report.counts.warn > 0) return { cls: 'mc-warn', text: '仅警告' }
  return { cls: 'mc-ok', text: '全部通过' }
}

function diffLineClass(line) {
  if (line.startsWith('@@')) return 'mc-hh'
  if (line.startsWith('+++') || line.startsWith('---')) return 'mc-dh'
  if (line.startsWith('+')) return 'mc-add'
  if (line.startsWith('-')) return 'mc-del'
  return 'mc-ctx'
}

function issueRow(issue) {
  const parts = []
  parts.push('<div class="mc-issue mc-sev-' + escapeHtml(issue.severity) + '">')
  parts.push('<div class="mc-issue-head">')
  parts.push('<span class="mc-rule">' + escapeHtml(issue.rule) + '</span>')
  parts.push('<span class="mc-loc">' + escapeHtml(formatLocation(issue)) + '</span>')
  if (issue.fixable) parts.push('<span class="mc-tag mc-tag-fix">可自动修复</span>')
  else parts.push('<span class="mc-tag mc-tag-manual">需人工</span>')
  if (issue.entryId) parts.push('<span class="mc-eid">' + escapeHtml(issue.entryId) + '</span>')
  parts.push('</div>')
  parts.push('<div class="mc-msg">' + escapeHtml(issue.message) + '</div>')
  if (issue.hint) parts.push('<div class="mc-hint">↳ ' + escapeHtml(issue.hint) + '</div>')
  if (issue.snippet) parts.push('<div class="mc-snippet">' + escapeHtml(issue.snippet) + '</div>')
  parts.push('</div>')
  return parts.join('')
}

function statCard(value, label, tone) {
  return '<div class="mc-stat' + (tone ? ' ' + tone : '') + '">' +
    '<b>' + escapeHtml(String(value)) + '</b><span>' + escapeHtml(label) + '</span></div>'
}

function headBlock(report, options) {
  const verdict = verdictOf(report)
  const parts = []
  parts.push('<div class="mc-head">')
  parts.push('<div class="mc-head-text">')
  parts.push('<div class="mc-title-row"><span class="mc-title">内容目录</span>' +
    '<span class="mc-verdict ' + verdict.cls + '">' + escapeHtml(verdict.text) + '</span></div>')
  parts.push('<div class="mc-sub">catalog.json · 金额 / 渲染 / 必填 / 图片</div>')
  parts.push('</div>')
  parts.push('<div class="mc-head-side">')
  parts.push('<span class="mc-path" title="' + escapeHtml(report.projectDir) + '">' +
    escapeHtml(tailPath(report.projectDir)) + '</span>')
  parts.push('<div class="mc-head-meta">')
  parts.push('<span class="mc-mode">' + (report.fixes.applied ? '已写入' : 'dry-run') + '</span>')
  parts.push('<span class="mc-time">' + escapeHtml(clock(report.at)) +
    (report.durationMs > 0 ? ' · ' + escapeHtml(String(report.durationMs)) + 'ms' : '') + '</span>')
  parts.push('</div>')
  parts.push('</div>')
  if (options.buttons !== false) {
    const canApply = report.fixes.count > 0 && !report.fixes.applied
    parts.push('<div class="mc-actions">')
    parts.push('<button class="mc-btn" type="button" data-action="rescan">重新检查</button>')
    parts.push('<button class="mc-btn mc-btn-primary" type="button" data-action="apply"' +
      (canApply ? '' : ' disabled') + '>应用修复' +
      (report.fixes.count > 0 ? ' · ' + report.fixes.count + ' 处' : '') + '</button>')
    parts.push('</div>')
  }
  parts.push('</div>')
  return parts.join('')
}

function statsBlock(report) {
  return '<div class="mc-stats">' +
    statCard(report.entries, '活动', '') +
    statCard(report.counts.error, '错误', 'mc-bad') +
    statCard(report.counts.warn, '警告', 'mc-warn') +
    statCard(report.counts.info, '信息', '') +
    statCard(report.fixes.count, '可自动修复', report.fixes.count > 0 ? 'mc-good' : '') +
    '</div>'
}

function issuesBlock(report) {
  if (report.issues.length === 0) return cleanBlock(report)
  const parts = []
  for (const severity of ['error', 'warn', 'info']) {
    const group = report.issues.filter(function (issue) { return issue.severity === severity })
    if (group.length === 0) continue
    parts.push('<div class="mc-section">')
    parts.push('<div class="mc-section-head"><span>' + escapeHtml(SEVERITY_LABEL[severity]) +
      '</span><span class="mc-count">' + group.length + '</span></div>')
    parts.push('<div class="mc-list">')
    for (const issue of group) parts.push(issueRow(issue))
    parts.push('</div></div>')
  }
  return parts.join('')
}

function cleanBlock(report) {
  return '<div class="mc-clean">' +
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 6 9 17l-5-5"/></svg>' +
    '<div><b>没有发现问题</b><span>' + escapeHtml(String(report.entries)) +
    ' 条活动的金额、必填、重复文案与图片路径都对得上' +
    (report.render && report.render.helper && report.render.helper.defined
      ? '，模板里的价格都走了 money()。'
      : '。') +
    '</span></div></div>'
}

function diffBlock(report, options) {
  const diff = report.fixes.diff
  if (typeof diff !== 'string' || diff.length === 0) return ''
  const stats = report.fixes.stats
  const limit = Number.isInteger(options.maxDiffLines) ? options.maxDiffLines : 400
  const lines = diff.replace(/\n$/, '').split('\n')
  const shown = lines.slice(0, limit)
  const parts = []
  parts.push('<div class="mc-section">')
  parts.push('<div class="mc-section-head"><span>修复 diff</span><span class="mc-count">' +
    report.fixes.count + ' 处 · ' + stats.hunks + ' 个 hunk · +' + stats.added + '/-' + stats.removed + ' 行</span></div>')
  parts.push('<div class="mc-diff">')
  parts.push('<div class="mc-diff-file"><span>' + escapeHtml(report.catalog) + '</span>' +
    '<span class="mc-dim">' +
    (report.fixes.applied
      ? '已写回文件'
      : (options.buttons === false ? 'dry-run，未写入' : 'dry-run，未写入；点「应用修复」或传 apply: true')) +
    '</span></div>')
  parts.push('<div class="mc-diff-body">')
  for (const line of shown) {
    parts.push('<div class="mc-dl ' + diffLineClass(line) + '">' + escapeHtml(line) + '</div>')
  }
  if (lines.length > shown.length) {
    parts.push('<div class="mc-dl mc-ctx">…还有 ' + (lines.length - shown.length) + ' 行</div>')
  }
  parts.push('</div></div></div>')
  return parts.join('')
}

function notesBlock(report) {
  const notes = Array.isArray(report.notes) ? report.notes : []
  const parts = []
  if (notes.length > 0) {
    parts.push('<div class="mc-notes">')
    for (const note of notes) parts.push('<div class="mc-note">注：' + escapeHtml(note) + '</div>')
    parts.push('</div>')
  }
  if (report.applyError) {
    parts.push('<div class="mc-error">写入失败：' + escapeHtml(report.applyError) + '</div>')
  }
  return parts.join('')
}

function scanBlock(report) {
  if (!report.render) return ''
  const helper = report.render.helper || { defined: false, where: [] }
  return '<div class="mc-scan">' +
    '<span>扫描 ' + escapeHtml(String(report.render.checkedFiles)) + ' 个模板/脚本</span>' +
    '<span class="mc-sep">·</span>' +
    '<span>money() ' + (helper.defined ? '已定义' : '未找到') + '</span>' +
    (helper.where.length > 0 ? '<span class="mc-dim mc-mono">' + escapeHtml(helper.where[0]) + '</span>' : '') +
    '</div>'
}

function emptyPanel() {
  return '<div class="mc-root">' +
    '<div class="mc-head"><div class="mc-head-text">' +
    '<div class="mc-title-row"><span class="mc-title">内容目录</span>' +
    '<span class="mc-verdict mc-idle">未检查</span></div>' +
    '<div class="mc-sub">catalog.json · 金额 / 渲染 / 必填 / 图片</div>' +
    '</div><div class="mc-actions"><button class="mc-btn" type="button" data-action="rescan">重新检查</button>' +
    '<button class="mc-btn mc-btn-primary" type="button" data-action="apply" disabled>应用修复</button>' +
    '</div></div>' +
    '<div class="mc-empty">' +
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>' +
    '<div class="mc-empty-title">还没有检查过</div>' +
    '<div class="mc-empty-sub">调用 mp_catalog_guard 工具，或点「重新检查」扫描当前项目目录。</div>' +
    '</div></div>'
}

/**
 * @param {any} report
 * @param {{static?: boolean, maxDiffLines?: number}} [options]
 */
export function renderPanelHtml(report, options) {
  const settings = options || {}
  if (!report || typeof report !== 'object' || typeof report.counts !== 'object') return emptyPanel()
  return '<div class="mc-root' + (settings.unclipped === true ? ' mc-static' : '') +
    '" data-plugin="dsh-mp-catalog-guard">' +
    headBlock(report, settings) +
    statsBlock(report) +
    issuesBlock(report) +
    diffBlock(report, settings) +
    scanBlock(report) +
    notesBlock(report) +
    '</div>'
}

/** Standalone document — no CDN, no scripts, safe to open from disk. */
export const PAGE_CSS = [
  '.mc-page{margin:0;padding:32px 20px 40px;min-height:100vh;box-sizing:border-box;',
  'background:var(--dsw-alias-bg-base,#f4f5f7);color:var(--dsw-alias-label-primary,#16181d);',
  'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;',
  '-webkit-font-smoothing:antialiased}',
  '.mc-page .mc-inner{max-width:860px;margin:0 auto;background:var(--dsw-alias-bg-layer-1,#fff);',
  'border:1px solid var(--dsw-alias-border-l1,rgba(16,18,24,.1));border-radius:14px;',
  'box-shadow:0 1px 2px rgba(16,18,24,.04),0 12px 32px -12px rgba(16,18,24,.12)}',
  '.mc-page .mc-inner .mc-root{padding:22px 24px 24px}',
  '.mc-page .mc-foot{max-width:860px;margin:12px auto 0;display:flex;gap:8px;flex-wrap:wrap;',
  'font-size:11.5px;color:var(--dsw-alias-label-secondary,rgba(22,24,29,.6));padding:0 4px}',
  '.mc-page .mc-foot code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.mc-page{--dsw-alias-bg-base:#f4f5f7;--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#f1f2f5;',
  '--dsw-alias-border-l1:rgba(16,18,24,.10);--dsw-alias-border-l2:rgba(16,18,24,.18);',
  '--dsw-alias-label-primary:#16181d;--dsw-alias-label-secondary:rgba(22,24,29,.62);',
  '--dsw-alias-brand-primary:#3b5bdb;--dsw-alias-state-error-primary:#c92a2a;',
  '--dsw-alias-state-warn-primary:#a15c00;--dsw-alias-state-success-primary:#1a7f37;',
  '--mc-radius:10px}',
  '.mc-page.mc-theme-dark{--dsw-alias-bg-base:#0e0f13;--dsw-alias-bg-layer-1:#16171d;',
  '--dsw-alias-bg-layer-2:#1c1e25;--dsw-alias-border-l1:rgba(255,255,255,.10);',
  '--dsw-alias-border-l2:rgba(255,255,255,.18);--dsw-alias-label-primary:rgba(255,255,255,.92);',
  '--dsw-alias-label-secondary:rgba(255,255,255,.58);--dsw-alias-brand-primary:#8ea8ff;',
  '--dsw-alias-state-error-primary:#ff7b72;--dsw-alias-state-warn-primary:#e3a008;',
  '--dsw-alias-state-success-primary:#57d18a}',
  '@media (prefers-color-scheme:dark){.mc-page:not(.mc-theme-light){--dsw-alias-bg-base:#0e0f13;',
  '--dsw-alias-bg-layer-1:#16171d;--dsw-alias-bg-layer-2:#1c1e25;',
  '--dsw-alias-border-l1:rgba(255,255,255,.10);--dsw-alias-border-l2:rgba(255,255,255,.18);',
  '--dsw-alias-label-primary:rgba(255,255,255,.92);--dsw-alias-label-secondary:rgba(255,255,255,.58);',
  '--dsw-alias-brand-primary:#8ea8ff;--dsw-alias-state-error-primary:#ff7b72;',
  '--dsw-alias-state-warn-primary:#e3a008;--dsw-alias-state-success-primary:#57d18a}}',
].join('')

/**
 * @param {any} report
 * @param {{css?: string, theme?: 'auto'|'light'|'dark', version?: string, panel?: boolean,
 *          maxDiffLines?: number}} [options]
 */
export function renderReportPage(report, options) {
  const settings = options || {}
  const theme = settings.theme === 'dark' ? 'mc-theme-dark' : (settings.theme === 'light' ? 'mc-theme-light' : '')
  const title = '内容目录检查 · ' + (report && report.catalog ? report.catalog : 'catalog.json')
  const version = settings.version ? '<code>dsh-mp-catalog-guard ' + escapeHtml(settings.version) + '</code>' : ''
  const panelNote = settings.panel === true
    ? '<span>这是内容目录面板的静态渲染；「重新检查 / 应用修复」只在 DSH 面板里可点。</span>'
    : ''
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + escapeHtml(title) + '</title>',
    '<style>' + PAGE_CSS + (settings.css === undefined ? pluginCss : settings.css) + '</style>',
    '</head><body class="mc-page ' + theme + '">',
    '<main class="mc-inner">' + renderPanelHtml(report, {
      buttons: settings.panel === true,
      unclipped: true,
      maxDiffLines: settings.maxDiffLines,
    }) + '</main>',
    '<div class="mc-foot"><span>' + escapeHtml(shortPath(report && report.catalogPath ? report.catalogPath : '', 96)) +
      '</span>' + (version ? '<span>' + version + '</span>' : '') + panelNote + '</div>',
    '</body></html>',
    '',
  ].join('\n')
}

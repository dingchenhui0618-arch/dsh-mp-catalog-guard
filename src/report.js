// Report assembly and the plain-text summary.
//
// One report object feeds all three consumers — the tool result, the CLI, and
// the panel — so the numbers a human sees in the GUI are the same numbers the
// agent got back, not three renderings that drifted apart.

import { diffStats } from './fix.js'
import { SEVERITY_LABEL, compareIssues, formatLocation } from './rules.js'

export function countSeverities(issues) {
  const counts = { error: 0, warn: 0, info: 0 }
  for (const issue of issues) {
    if (counts[issue.severity] !== undefined) counts[issue.severity] += 1
  }
  return counts
}

/**
 * @param {{projectDir: string, catalog: string, catalogPath: string,
 *          mode?: 'dry-run'|'apply', applied?: boolean, applyError?: string,
 *          parsed?: boolean, entries?: number, issues?: any[], diff?: string,
 *          fixes?: {changes: any[]}, render?: any, scan?: any, notes?: string[],
 *          at?: Date, durationMs?: number}} input
 */
export function assembleReport(input) {
  const issues = (Array.isArray(input.issues) ? input.issues : []).slice().sort(compareIssues)
  const counts = countSeverities(issues)
  const changes = input.fixes && Array.isArray(input.fixes.changes) ? input.fixes.changes : []
  const diff = typeof input.diff === 'string' ? input.diff : ''

  const report = {
    version: 1,
    at: (input.at instanceof Date ? input.at : new Date()).toISOString(),
    projectDir: String(input.projectDir || ''),
    catalog: String(input.catalog || 'catalog.json'),
    catalogPath: String(input.catalogPath || ''),
    mode: input.mode === 'apply' ? 'apply' : 'dry-run',
    parsed: input.parsed === true,
    entries: Number.isInteger(input.entries) ? input.entries : 0,
    counts: counts,
    ok: counts.error === 0,
    clean: issues.length === 0,
    issues: issues,
    fixes: {
      count: changes.length,
      changes: changes,
      diff: diff,
      stats: diffStats(diff),
      applied: input.applied === true,
    },
    notes: Array.isArray(input.notes) ? input.notes.slice() : [],
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : 0,
  }
  if (typeof input.applyError === 'string' && input.applyError.length > 0) report.applyError = input.applyError
  if (input.render !== undefined) report.render = input.render
  if (input.scan !== undefined) report.scan = input.scan
  return report
}

/** One line per issue, aligned enough to scan in a terminal or a tool card. */
export function formatIssueLine(issue) {
  const location = formatLocation(issue) || issue.file || ''
  return [location, issue.rule, issue.message].filter(function (part) { return part && part.length > 0 }).join('  ')
}

/**
 * The text an agent (or a terminal) actually reads.
 *
 * @param {any} report
 * @param {{maxIssues?: number, maxDiffLines?: number}} [options]
 */
export function summaryText(report, options) {
  if (!report || typeof report !== 'object') return '没有可显示的检查结果。'
  const settings = options || {}
  const maxIssues = Number.isInteger(settings.maxIssues) ? settings.maxIssues : 40
  const maxDiffLines = Number.isInteger(settings.maxDiffLines) ? settings.maxDiffLines : 60

  const lines = []
  lines.push('内容目录检查 · ' + (report.projectDir || '(未知目录)'))
  const counts = report.counts || { error: 0, warn: 0, info: 0 }
  lines.push(
    report.catalog + ' · ' + report.entries + ' 条活动 · 错误 ' + counts.error +
    ' · 警告 ' + counts.warn + ' · 信息 ' + counts.info +
    (report.fixes && report.fixes.count > 0 ? ' · 可自动修复 ' + report.fixes.count : ''),
  )
  if (report.mode === 'apply' && report.fixes && report.fixes.applied) {
    lines.push('模式：apply —— 自动修复已写回 ' + report.catalog)
  } else if (report.mode === 'apply') {
    lines.push('模式：apply —— 没有可自动修复的项，文件未改动')
  } else if (report.fixes && report.fixes.count > 0) {
    lines.push('模式：dry-run —— 未写入；要落地用 apply: true')
  } else {
    lines.push('模式：dry-run')
  }
  if (report.applyError) lines.push('写入失败：' + report.applyError)

  const issues = Array.isArray(report.issues) ? report.issues : []
  for (const severity of ['error', 'warn', 'info']) {
    const group = issues.filter(function (issue) { return issue.severity === severity })
    if (group.length === 0) continue
    lines.push('')
    lines.push(SEVERITY_LABEL[severity] + ' (' + group.length + ')')
    for (const issue of group.slice(0, maxIssues)) {
      lines.push('  ' + formatIssueLine(issue))
      if (issue.hint) lines.push('    ↳ ' + issue.hint)
    }
    if (group.length > maxIssues) lines.push('  …还有 ' + (group.length - maxIssues) + ' 条（--json 可看全部）')
  }
  if (issues.length === 0 && report.parsed !== false) {
    lines.push('')
    lines.push('没有发现问题。')
  }

  const diff = report.fixes && typeof report.fixes.diff === 'string' ? report.fixes.diff : ''
  if (diff.length > 0) {
    const stats = report.fixes.stats || { hunks: 0, added: 0, removed: 0 }
    lines.push('')
    lines.push('修复 diff：' + report.fixes.count + ' 处，' + stats.hunks + ' 个 hunk，+' +
      stats.added + '/' + stats.removed + ' 行')
    const diffLines = diff.replace(/\n$/, '').split('\n')
    for (const line of diffLines.slice(0, maxDiffLines)) lines.push(line)
    if (diffLines.length > maxDiffLines) lines.push('…（diff 还有 ' + (diffLines.length - maxDiffLines) + ' 行）')
  }

  const notes = Array.isArray(report.notes) ? report.notes : []
  if (notes.length > 0) {
    lines.push('')
    for (const note of notes) lines.push('注：' + note)
  }
  return lines.join('\n')
}

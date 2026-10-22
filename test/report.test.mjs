// Rules and report-assembly tests: ordering, labels, and the numbers every
// consumer (tool, CLI, panel) reads from the same object.

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { assembleReport, countSeverities, formatIssueLine, summaryText } from '../src/report.js'
import {
  RULES,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  compareIssues,
  formatLocation,
  makeIssue,
  ruleMeta,
} from '../src/rules.js'

test('every rule id is unique and has a severity and a label', function () {
  const ids = Object.keys(RULES)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) {
    assert.ok(['error', 'warn', 'info'].includes(RULES[id].severity), id)
    assert.ok(typeof RULES[id].label === 'string' && RULES[id].label.length > 0, id)
  }
})

test('an unknown rule id falls back to a warning instead of crashing a run', function () {
  const meta = ruleMeta('no-such-rule')
  assert.equal(meta.severity, 'warn')
  assert.equal(meta.label, 'no-such-rule')
  const issue = makeIssue('no-such-rule', { message: 'x' })
  assert.equal(issue.severity, 'warn')
})

test('a known rule keeps its declared severity even if a caller asks for another', function () {
  const issue = makeIssue('image-missing', { message: 'x', severity: 'info' })
  assert.equal(issue.severity, 'info', 'an explicit severity wins for special cases')
  assert.equal(ruleMeta('image-missing').severity, 'error')
})

test('makeIssue fills the label and drops empty fields', function () {
  const issue = makeIssue('image-missing', { file: 'catalog.json', line: 7, message: 'x', extra: undefined })
  assert.equal(issue.rule, 'image-missing')
  assert.equal(issue.severity, 'error')
  assert.equal(issue.label, RULES['image-missing'].label)
  assert.equal(issue.line, 7)
  assert.equal(issue.fixable, false)
  assert.equal(Object.prototype.hasOwnProperty.call(issue, 'extra'), false)
})

test('issues sort error, warn, info, then by file and line', function () {
  const issues = [
    makeIssue('image-remote', { file: 'b.json', line: 1 }),
    makeIssue('image-missing', { file: 'b.json', line: 9 }),
    makeIssue('image-missing', { file: 'a.json', line: 5 }),
    makeIssue('amount-fen-zero', { file: 'a.json', line: 2 }),
  ]
  const sorted = issues.slice().sort(compareIssues).map(function (issue) {
    return issue.severity + ':' + issue.file + ':' + issue.line
  })
  assert.deepEqual(sorted, [
    'error:a.json:5',
    'error:b.json:9',
    'warn:a.json:2',
    'info:b.json:1',
  ])
})

test('an issue without a line sorts before located ones in the same file', function () {
  const located = makeIssue('image-missing', { file: 'a.json', line: 3 })
  const unlocated = makeIssue('image-missing', { file: 'a.json' })
  assert.equal([located, unlocated].sort(compareIssues)[0], unlocated)
})

test('severity labels and order are the Chinese ones the summary prints', function () {
  assert.deepEqual(SEVERITY_ORDER, { error: 0, warn: 1, info: 2 })
  assert.equal(SEVERITY_LABEL.error, '错误')
  assert.equal(SEVERITY_LABEL.warn, '警告')
  assert.equal(SEVERITY_LABEL.info, '信息')
})

test('a location is file:line, or file#entry when the line is unknown', function () {
  assert.equal(formatLocation({ file: 'catalog.json', line: 12 }), 'catalog.json:12')
  assert.equal(formatLocation({ file: 'catalog.json', entry: 2 }), 'catalog.json#3')
  assert.equal(formatLocation({ entry: 0 }), '#1')
  assert.equal(formatLocation({}), '')
})

test('formatIssueLine joins location, rule and message', function () {
  const line = formatIssueLine(makeIssue('image-missing', {
    file: 'catalog.json', line: 4, message: '图片不存在',
  }))
  assert.match(line, /^catalog\.json:4 {2}image-missing {2}图片不存在$/)
})

test('countSeverities only counts known severities', function () {
  assert.deepEqual(countSeverities([
    { severity: 'error' }, { severity: 'error' }, { severity: 'info' }, { severity: 'weird' },
  ]), { error: 2, warn: 0, info: 1 })
})

test('assembleReport derives ok, clean and the diff stats', function () {
  const report = assembleReport({
    projectDir: '/p',
    catalog: 'catalog.json',
    catalogPath: '/p/catalog.json',
    parsed: true,
    entries: 2,
    issues: [makeIssue('image-missing', { file: 'catalog.json', line: 3 })],
    fixes: { changes: [{ rule: 'amount-legacy' }] },
    diff: '--- a/catalog.json\n+++ b/catalog.json\n@@ -1 +1 @@\n-a\n+b\n',
    notes: ['n'],
    durationMs: 12,
    at: new Date('2026-10-22T02:00:00.000Z'),
  })
  assert.equal(report.ok, false)
  assert.equal(report.clean, false)
  assert.equal(report.counts.error, 1)
  assert.equal(report.fixes.count, 1)
  assert.equal(report.fixes.stats.hunks, 1)
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.at, '2026-10-22T02:00:00.000Z')
  assert.deepEqual(report.notes, ['n'])
})

test('warnings alone keep ok:true because they do not fail the run', function () {
  const report = assembleReport({
    projectDir: '/p',
    catalog: 'catalog.json',
    parsed: true,
    entries: 1,
    issues: [makeIssue('amount-fen-zero', { message: '0 元' })],
  })
  assert.equal(report.counts.warn, 1)
  assert.equal(report.ok, true)
  assert.equal(report.clean, false)
})

test('a report with no issues is clean and ok', function () {
  const report = assembleReport({ projectDir: '/p', catalog: 'catalog.json', parsed: true, entries: 1 })
  assert.equal(report.ok, true)
  assert.equal(report.clean, true)
  assert.equal(report.fixes.applied, false)
  assert.equal(summaryText(report).includes('没有发现问题'), true)
})

test('apply failures are carried as applyError', function () {
  const report = assembleReport({ projectDir: '/p', catalog: 'catalog.json', applyError: 'EACCES' })
  assert.equal(report.applyError, 'EACCES')
  assert.match(summaryText(report), /写入失败：EACCES/)
})

test('summaryText of a non-report is a sentence, not a crash', function () {
  assert.equal(summaryText(undefined), '没有可显示的检查结果。')
})

// End-to-end checks through checkProject with an in-memory filesystem: the
// report's shape, the dry-run default, apply, and the failure paths.

import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import test from 'node:test'
import { checkProject, displayPath } from '../src/check.js'
import { memoryIo } from '../src/io.js'
import { summaryText } from '../src/report.js'

const ROOT = process.platform === 'win32' ? 'C:\\proj' : '/proj'

function files(extra) {
  return Object.assign({
    [join(ROOT, 'catalog.json')]: JSON.stringify({
      activities: [
        { id: 'a', title: '秋季套餐', subtitle: '含茶位', amountFen: 1990, image: 'images/a.png' },
      ],
    }, null, 2) + '\n',
  }, extra || {})
}

function projectIo(extra, options) {
  const declared = files(extra)
  return memoryIo(declared, Object.assign({
    exists: function (path) { return Object.prototype.hasOwnProperty.call(declared, path) },
  }, options || {}))
}

function ids(report) {
  return report.issues.map(function (issue) { return issue.rule })
}

test('a clean project reports no issues and ok:true', async function () {
  const io = projectIo({ [join(ROOT, 'images', 'a.png')]: '' })
  const report = await checkProject({ projectDir: ROOT }, io)
  assert.equal(report.ok, true)
  assert.equal(report.clean, true)
  assert.equal(report.entries, 1)
  assert.deepEqual(report.counts, { error: 0, warn: 0, info: 0 })
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.parsed, true)
})

test('dry-run is the default: nothing is written even when fixes exist', async function () {
  const io = memoryIo(files({
    [join(ROOT, 'catalog.json')]: JSON.stringify({
      activities: [{ id: 'a', title: 'A', amount: 128, image: 'images/a.png' }],
    }, null, 2) + '\n',
  }), { exists: function (path) { return path.endsWith('a.png') } })
  const report = await checkProject({ projectDir: ROOT }, io)
  assert.equal(report.fixes.count, 1)
  assert.equal(report.fixes.applied, false)
  assert.equal(io.writes.length, 0)
  assert.match(report.fixes.diff, /^--- a\/catalog\.json/)
  assert.ok(report.fixes.stats.added > 0)
})

test('apply:true writes the catalog and says so', async function () {
  const path = join(ROOT, 'catalog.json')
  const io = memoryIo(files({
    [path]: '{\n  "activities": [\n    {\n      "id": "a",\n      "title": "A",\n      "amountFen": "12800",\n      "image": "images/a.png"\n    }\n  ]\n}\n',
  }), { exists: function (target) { return target.endsWith('a.png') } })
  const report = await checkProject({ projectDir: ROOT, apply: true }, io)
  assert.equal(report.mode, 'apply')
  assert.equal(report.fixes.applied, true)
  assert.equal(io.writes.length, 1)
  const written = JSON.parse(io.writes[0].text)
  assert.equal(written.activities[0].amountFen, 12800)
  assert.equal(typeof written.activities[0].amountFen, 'number')
})

test('apply on something with no fixable issue leaves the file alone', async function () {
  const io = projectIo({ [join(ROOT, 'images', 'a.png')]: '' })
  const report = await checkProject({ projectDir: ROOT, apply: true }, io)
  assert.equal(report.fixes.applied, false)
  assert.equal(io.writes.length, 0)
  assert.ok(report.notes.some(function (note) { return /没有可自动修复/.test(note) }))
})

test('a missing catalog is a readable error, not an exception', async function () {
  const io = memoryIo({}, {})
  const report = await checkProject({ projectDir: ROOT }, io)
  assert.deepEqual(ids(report), ['catalog-unreadable'])
  assert.equal(report.parsed, false)
  assert.equal(report.ok, false)
})

test('broken JSON reports catalog-parse and stops there', async function () {
  const io = memoryIo({ [join(ROOT, 'catalog.json')]: '{ "activities": [ }' }, {})
  const report = await checkProject({ projectDir: ROOT }, io)
  assert.deepEqual(ids(report), ['catalog-parse'])
  assert.equal(report.clean, false)
})

test('an object without an activity array reports catalog-shape', async function () {
  const io = memoryIo({ [join(ROOT, 'catalog.json')]: '{ "activities": {} }' }, {})
  const report = await checkProject({ projectDir: ROOT }, io)
  assert.deepEqual(ids(report), ['catalog-shape'])
})

test('every rule family fires on one deliberately broken catalog', async function () {
  const catalog = {
    activities: [
      { id: 'a', title: 'A', subtitle: '含茶位与甜品', amountFen: 19.9, image: 'images/a.png' },
      { id: 'a', title: 'A', subtitle: '含茶位与甜品', amount: 128, image: '/images/a.png' },
      { id: 'b', title: 'B', amountFen: '6800', image: 'images/gone.png' },
    ],
  }
  const io = memoryIo({
    [join(ROOT, 'catalog.json')]: JSON.stringify(catalog, null, 2) + '\n',
    [join(ROOT, 'pages', 'index.wxml')]: '<text>¥{{item.amountFen / 100}}</text>',
    [join(ROOT, 'pages', 'detail.wxml')]: '<text>合计 {{item.amountFen}}</text>',
  }, {
    exists: function (path) { return path === join(ROOT, 'images', 'a.png') },
    sourceFiles: [
      { path: 'pages/index.wxml', text: '<text>¥{{item.amountFen / 100}}</text>' },
      { path: 'pages/detail.wxml', text: '<text>合计 {{item.amountFen}}</text>' },
    ],
  })
  const report = await checkProject({ projectDir: ROOT }, io)
  const found = new Set(ids(report))
  for (const rule of [
    'amount-fen-float', 'id-duplicate', 'title-duplicate', 'subtitle-duplicate',
    'amount-legacy', 'amount-fen-string', 'image-absolute', 'image-missing',
    'money-inline-divide', 'money-raw-fen', 'money-helper-missing',
  ]) {
    assert.ok(found.has(rule), 'expected rule ' + rule + ' in ' + Array.from(found).join(','))
  }
  assert.equal(report.entries, 3)
  assert.equal(report.ok, false)
})

test('render:false skips the template scan entirely', async function () {
  const io = projectIo({ [join(ROOT, 'images', 'a.png')]: '' })
  const report = await checkProject({ projectDir: ROOT, render: false }, io)
  assert.equal(report.render, undefined)
  assert.equal(report.scan.render, false)
  assert.equal(report.clean, true)
})

test('the catalog file can live elsewhere via --catalog', async function () {
  const path = join(ROOT, 'data', 'activities.json')
  const io = memoryIo({ [path]: '{"items":[{"id":"a","title":"A","amountFen":100,"image":"i.png"}]}' }, {
    exists: function (target) { return target.endsWith('i.png') },
  })
  const report = await checkProject({ projectDir: ROOT, catalog: 'data/activities.json' }, io)
  assert.equal(report.entries, 1)
  assert.equal(report.catalog, 'data/activities.json')
  assert.equal(report.clean, true)
})

test('a custom required field list is honoured', async function () {
  const io = projectIo({ [join(ROOT, 'images', 'a.png')]: '' })
  const report = await checkProject({ projectDir: ROOT, requiredFields: ['id', 'title', 'amountFen', 'image', 'summary'] }, io)
  assert.ok(ids(report).includes('field-missing'))
  assert.equal(report.scan.requiredFields.includes('summary'), true)
})

test('a report survives JSON: it is what the tool and the panel both consume', async function () {
  const io = projectIo({ [join(ROOT, 'images', 'a.png')]: '' })
  const report = await checkProject({ projectDir: ROOT }, io)
  const roundTrip = JSON.parse(JSON.stringify(report))
  assert.deepEqual(roundTrip.counts, report.counts)
  const text = summaryText(roundTrip)
  assert.match(text, /内容目录检查/)
  assert.match(text, /1 条活动/)
  assert.match(text, /dry-run/)
})

test('displayPath keeps paths inside the project relative', function () {
  assert.equal(displayPath(ROOT, join(ROOT, 'catalog.json')), 'catalog.json')
  const outside = process.platform === 'win32' ? 'C:\\other\\catalog.json' : '/other/catalog.json'
  assert.equal(displayPath(ROOT, outside), outside.replace(/\\/g, '/'))
})

test('summaryText lists counts, issues and the diff, and caps long lists', function () {
  const report = {
    projectDir: ROOT,
    catalog: 'catalog.json',
    entries: 2,
    mode: 'dry-run',
    parsed: true,
    counts: { error: 2, warn: 0, info: 0 },
    issues: [
      { rule: 'x', severity: 'error', message: '第一个', file: 'catalog.json', line: 3 },
      { rule: 'y', severity: 'error', message: '第二个', file: 'catalog.json', line: 9 },
    ],
    fixes: { count: 1, diff: '--- a/catalog.json\n+++ b/catalog.json\n@@ -1,1 +1,1 @@\n-a\n+b\n', stats: { hunks: 1, added: 1, removed: 1, lines: 6 } },
    notes: ['一条注记'],
  }
  const text = summaryText(report, { maxIssues: 1, maxDiffLines: 3 })
  assert.match(text, /错误 2/)
  assert.match(text, /…还有 1 条/)
  assert.match(text, /diff 还有/)
  assert.match(text, /注：一条注记/)
})

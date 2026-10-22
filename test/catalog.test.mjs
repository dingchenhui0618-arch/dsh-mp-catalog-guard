// Catalog model tests: parsing shapes, the amount contract, duplicate copy and
// line location. Pure functions, no filesystem.

import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  DEFAULT_REQUIRED_FIELDS,
  checkCatalog,
  locateEntries,
  normalizeCopy,
  parseCatalog,
  toFenAmount,
} from '../src/catalog.js'

function rulesOf(issues) {
  return issues.map(function (issue) { return issue.rule })
}

function find(issues, rule) {
  return issues.filter(function (issue) { return issue.rule === rule })
}

function check(activities, options) {
  return checkCatalog(activities, options).issues
}

// ---- parsing --------------------------------------------------------------

test('a top-level array is a catalog', function () {
  const parsed = parseCatalog('[{"id":"a","title":"A","amountFen":100,"image":"i.png"}]')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.activities.length, 1)
  assert.deepEqual(parsed.container, { kind: 'array', key: '' })
})

test('an activities / items / list / entries / products wrapper is a catalog', function () {
  for (const key of ['activities', 'items', 'list', 'entries', 'products']) {
    const parsed = parseCatalog(JSON.stringify({ [key]: [{ id: 'a' }] }))
    assert.equal(parsed.ok, true, key)
    assert.equal(parsed.activities.length, 1, key)
    assert.deepEqual(parsed.container, { kind: 'key', key: key }, key)
  }
})

test('a broken JSON file reports a parse error, not a crash', function () {
  const parsed = parseCatalog('{"activities": [}')
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /JSON/)
  assert.equal(parsed.data, undefined)
})

test('an object without an activity array is a shape error and keeps the data', function () {
  const parsed = parseCatalog('{"version": 2, "activities": {}}')
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /activities/)
  assert.equal(parsed.data.version, 2)
})

test('an empty file and a non-object top level are rejected', function () {
  assert.equal(parseCatalog('').ok, false)
  assert.equal(parseCatalog('   ').ok, false)
  assert.equal(parseCatalog('42').ok, false)
  assert.equal(parseCatalog('"catalog"').ok, false)
})

test('a UTF-8 BOM does not break parsing', function () {
  const parsed = parseCatalog('\uFEFF[{"id":"a"}]')
  assert.equal(parsed.ok, true)
})

// ---- required fields and identity ----------------------------------------

test('a missing required field is reported with the field name', function () {
  const issues = check([{ id: 'a', amountFen: 100, image: 'i.png' }])
  const missing = find(issues, 'field-missing')
  assert.equal(missing.length, 1)
  assert.equal(missing[0].field, 'title')
  assert.equal(missing[0].severity, 'error')
})

test('an empty title counts as missing', function () {
  const issues = check([{ id: 'a', title: '   ', amountFen: 100, image: 'i.png' }])
  assert.ok(find(issues, 'field-missing').some(function (issue) { return issue.field === 'title' }))
})

test('extra required fields can be declared', function () {
  const issues = check([{ id: 'a', title: 'A', amountFen: 100, image: 'i.png' }], {
    requiredFields: DEFAULT_REQUIRED_FIELDS.concat(['summary']),
  })
  assert.ok(find(issues, 'field-missing').some(function (issue) { return issue.field === 'summary' }))
})

test('a duplicate id is an error that names the first occurrence', function () {
  const issues = check([
    { id: 'a', title: 'A', amountFen: 100, image: 'i.png' },
    { id: 'a', title: 'B', amountFen: 200, image: 'i.png' },
  ])
  const duplicate = find(issues, 'id-duplicate')
  assert.equal(duplicate.length, 1)
  assert.match(duplicate[0].message, /第 1 条/)
  assert.equal(duplicate[0].entry, 1)
})

test('a non-string id is rejected rather than silently stringified', function () {
  const issues = check([{ id: 7, title: 'A', amountFen: 100, image: 'i.png' }])
  assert.ok(find(issues, 'field-missing').some(function (issue) { return issue.field === 'id' }))
})

test('an entry that is not an object is reported once and skipped', function () {
  const issues = check(['nope', 42, null])
  assert.equal(find(issues, 'entry-not-object').length, 3)
})

// ---- amounts --------------------------------------------------------------

test('a fractional amountFen is an error with a conversion hint', function () {
  const issues = check([{ id: 'a', title: 'A', amountFen: 19.9, image: 'i.png' }])
  const issue = find(issues, 'amount-fen-float')[0]
  assert.ok(issue)
  assert.equal(issue.severity, 'error')
  assert.match(issue.hint, /1990/)
})

test('a digits-only amountFen string is fixable', function () {
  const issues = check([{ id: 'a', title: 'A', amountFen: '19900', image: 'i.png' }])
  const issue = find(issues, 'amount-fen-string')[0]
  assert.ok(issue)
  assert.equal(issue.fixable, true)
})

test('a decimal amountFen string is reported but not auto-fixed', function () {
  const issues = check([{ id: 'a', title: 'A', amountFen: '19.90', image: 'i.png' }])
  const issue = find(issues, 'amount-fen-string')[0]
  assert.ok(issue)
  assert.equal(issue.fixable, false)
})

test('the whole range of bad amountFen values is covered', function () {
  const cases = [
    [-100, 'amount-fen-negative', 'error'],
    [0, 'amount-fen-zero', 'warn'],
    [20_000_000, 'amount-fen-suspicious', 'warn'],
    [true, 'amount-unreadable', 'error'],
    [null, 'amount-unreadable', 'error'],
  ]
  for (const [value, rule, severity] of cases) {
    const issues = check([{ id: 'a', title: 'A', amountFen: value, image: 'i.png' }])
    const issue = find(issues, rule)[0]
    assert.ok(issue, rule + ' for ' + JSON.stringify(value))
    assert.equal(issue.severity, severity, rule)
  }
})

test('a legacy yuan amount is flagged as fixable and shows the converted Fen', function () {
  const issues = check([{ id: 'a', title: 'A', amount: 128, image: 'i.png' }])
  const issue = find(issues, 'amount-legacy')[0]
  assert.ok(issue)
  assert.equal(issue.fixable, true)
  assert.match(issue.message, /12800/)
  assert.equal(issue.field, 'amount')
})

test('currency symbols and separators are understood in a legacy field', function () {
  const issues = check([{ id: 'a', title: 'A', price: '¥1,999.90', image: 'i.png' }])
  const issue = find(issues, 'amount-legacy')[0]
  assert.ok(issue)
  assert.match(issue.message, /199990/)
})

test('a legacy amount with more than two decimals is not auto-fixable', function () {
  const issues = check([{ id: 'a', title: 'A', amount: 19.999, image: 'i.png' }])
  assert.equal(find(issues, 'amount-legacy').length, 0)
  assert.equal(find(issues, 'amount-imprecise').length, 1)
})

test('an unreadable legacy amount is an error with no fix', function () {
  const issues = check([{ id: 'a', title: 'A', amount: '待定', image: 'i.png' }])
  const issue = find(issues, 'amount-unreadable')[0]
  assert.ok(issue)
  assert.equal(issue.fixable, false)
})

test('an entry with no amount field at all is an error', function () {
  const issues = check([{ id: 'a', title: 'A', image: 'i.png' }])
  const issue = find(issues, 'amount-missing')[0]
  assert.ok(issue)
  assert.equal(issue.field, 'amountFen')
})

test('amountFen plus a legacy field is a warning, not a silent pass', function () {
  const issues = check([{ id: 'a', title: 'A', amountFen: 12800, amount: 128, image: 'i.png' }])
  const issue = find(issues, 'amount-duplicate-field')[0]
  assert.ok(issue)
  assert.equal(issue.severity, 'warn')
})

// ---- duplicate copy -------------------------------------------------------

test('duplicate titles are found after normalising punctuation and spaces', function () {
  const issues = check([
    { id: 'a', title: '秋季套餐 3 人', amountFen: 100, image: 'i.png' },
    { id: 'b', title: '秋季套餐3人！', amountFen: 200, image: 'i.png' },
  ])
  assert.equal(find(issues, 'title-duplicate').length, 1)
})

test('short repeated subtitles are tolerated, long ones are not', function () {
  const short = check([
    { id: 'a', title: 'A', subtitle: '限时', amountFen: 100, image: 'i.png' },
    { id: 'b', title: 'B', subtitle: '限时', amountFen: 200, image: 'i.png' },
  ])
  assert.equal(find(short, 'subtitle-duplicate').length, 0)

  const long = check([
    { id: 'a', title: 'A', subtitle: '含茶位与甜品', amountFen: 100, image: 'i.png' },
    { id: 'b', title: 'B', subtitle: '含茶位与甜品', amountFen: 200, image: 'i.png' },
  ])
  assert.equal(find(long, 'subtitle-duplicate').length, 1)
})

test('the duplicate threshold is configurable', function () {
  const issues = check([
    { id: 'a', title: 'A', subtitle: '限时', amountFen: 100, image: 'i.png' },
    { id: 'b', title: 'B', subtitle: '限时', amountFen: 200, image: 'i.png' },
  ], { minDuplicateLength: 2 })
  assert.equal(find(issues, 'subtitle-duplicate').length, 1)
})

// ---- helpers --------------------------------------------------------------

test('normalizeCopy folds full-width characters, spaces and punctuation', function () {
  assert.equal(normalizeCopy('ＡＢＣ　１２３！'), normalizeCopy('abc123'))
  assert.equal(normalizeCopy('  '), '')
  assert.equal(normalizeCopy(undefined), '')
})

test('toFenAmount marks exact conversions and rejects rubbish', function () {
  assert.deepEqual(toFenAmount(19.9), { fen: 1990, exact: true })
  assert.deepEqual(toFenAmount('¥19.90'), { fen: 1990, exact: true })
  assert.deepEqual(toFenAmount('1,999'), { fen: 199900, exact: true })
  assert.equal(toFenAmount(19.999).exact, false)
  assert.equal(toFenAmount('abc'), undefined)
  assert.equal(toFenAmount(Number.NaN), undefined)
  assert.equal(toFenAmount(null), undefined)
})

test('entries are located by a unique id, then by a unique title, else not at all', function () {
  const text = [
    '{',
    '  "activities": [',
    '    { "id": "only_one", "title": "A" },',
    '    { "id": "twice", "title": "B" },',
    '    { "id": "twice", "title": "B" },',
    '    { "id": "twice", "title": "C" }',
    '  ]',
    '}',
  ].join('\n')
  const activities = [
    { id: 'only_one', title: 'A' },
    { id: 'twice', title: 'B' },
    { id: 'twice', title: 'B' },
    { id: 'twice', title: 'C' },
  ]
  const lines = locateEntries(text, activities)
  assert.equal(lines[0], 3)
  // both id and title are ambiguous → no line is better than the wrong line
  assert.equal(lines[1], undefined)
  assert.equal(lines[2], undefined)
  // duplicate id, but this one's title is unique → the real line is still known
  assert.equal(lines[3], 6)
})

test('an entry with no id is located by its title', function () {
  const text = '[\n  { "title": "唯一标题", "amountFen": 1 }\n]'
  const lines = locateEntries(text, [{ title: '唯一标题', amountFen: 1 }])
  assert.equal(lines[0], 2)
})

test('issue locations carry the file, line and entry id', function () {
  const text = '[\n  { "id": "a", "title": "A", "amountFen": 1.5, "image": "i.png" }\n]'
  const issues = checkCatalog([{ id: 'a', title: 'A', amountFen: 1.5, image: 'i.png' }], {
    text: text,
    file: 'data/catalog.json',
  }).issues
  const issue = issues.find(function (item) { return item.rule === 'amount-fen-float' })
  assert.equal(issue.file, 'data/catalog.json')
  assert.equal(issue.line, 2)
  assert.equal(issue.entryId, 'a')
  assert.equal(issue.entry, 0)
})

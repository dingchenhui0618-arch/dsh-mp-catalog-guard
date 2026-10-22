// Fix planning and diff tests. The two guarantees under test: a fix is only
// planned when it has one unambiguous result, and the emitted text keeps the
// file's own formatting so the diff shows the change and nothing else.

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { parseCatalog } from '../src/catalog.js'
import {
  diffLines,
  diffStats,
  detectEol,
  detectIndent,
  isMinified,
  planFixes,
  serializeCatalog,
  unifiedDiff,
} from '../src/fix.js'

const SOURCE = JSON.stringify({
  activities: [
    { id: 'a', title: 'A', subtitle: 'S', amount: 128, image: 'images/a.png' },
    { id: 'b', title: 'B', amountFen: '19900', image: '/images/b.png' },
  ],
}, null, 2) + '\n'

function plan(source, options) {
  const parsed = parseCatalog(source)
  assert.equal(parsed.ok, true)
  return planFixes(parsed, Object.assign({ sourceText: source }, options))
}

// ---- serialisation --------------------------------------------------------

test('the indent unit is read from the file, not assumed', function () {
  assert.equal(detectIndent('{\n  "a": 1\n}'), '  ')
  assert.equal(detectIndent('{\n    "a": 1\n}'), '    ')
  assert.equal(detectIndent('{\n\t"a": 1\n}'), '\t')
  assert.equal(detectIndent('{"a":1}'), '  ')
})

test('CRLF files stay CRLF and a trailing newline is preserved', function () {
  assert.equal(detectEol('{\r\n  "a": 1\r\n}'), '\r\n')
  assert.equal(detectEol('{\n  "a": 1\n}'), '\n')
  const crlf = serializeCatalog({ a: 1 }, '{\r\n  "a": 2\r\n}\r\n')
  assert.equal(crlf, '{\r\n  "a": 1\r\n}\r\n')
  const noTrailing = serializeCatalog({ a: 1 }, '{\n  "a": 2\n}')
  assert.equal(noTrailing, '{\n  "a": 1\n}')
})

test('a minified catalog is detected and re-indented', function () {
  assert.equal(isMinified('{"a":1}'), true)
  assert.equal(isMinified('{\n"a":1\n}'), false)
  assert.equal(serializeCatalog({ a: 1 }, '{"a":2}'), '{\n  "a": 1\n}')
})

// ---- diff -----------------------------------------------------------------

test('identical texts produce no diff at all', function () {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '')
})

test('a one-line change produces one hunk with three context lines', function () {
  const before = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n') + '\n'
  const after = ['a', 'b', 'c', 'D', 'e', 'f'].join('\n') + '\n'
  const diff = unifiedDiff(before, after, { path: 'catalog.json' })
  assert.match(diff, /^--- a\/catalog\.json\n\+\+\+ b\/catalog\.json\n/)
  assert.match(diff, /@@ -1,6 \+1,6 @@/)
  assert.match(diff, /^-d$/m)
  assert.match(diff, /^\+D$/m)
  assert.match(diff, /^ c$/m)
})

test('changes far apart become separate hunks; nearby ones merge', function () {
  const lines = []
  for (let i = 0; i < 30; i++) lines.push('line' + i)
  const far = lines.slice()
  far[0] = 'changed0'
  far[29] = 'changed29'
  const farDiff = unifiedDiff(lines.join('\n') + '\n', far.join('\n') + '\n')
  assert.equal((farDiff.match(/^@@/gm) || []).length, 2)

  const near = lines.slice()
  near[0] = 'changed0'
  near[1] = 'changed1'
  const nearDiff = unifiedDiff(lines.join('\n') + '\n', near.join('\n') + '\n')
  assert.equal((nearDiff.match(/^@@/gm) || []).length, 1)
})

test('the diff is LF-normalised so a CRLF file still diffs by content', function () {
  const before = 'a\r\nb\r\nc\r\n'
  const after = 'a\nB\nc\n'
  const diff = unifiedDiff(before, after)
  assert.match(diff, /^-b$/m)
  assert.match(diff, /^\+B$/m)
  assert.equal(diff.indexOf('\r'), -1)
})

test('diffStats counts hunks, additions and removals', function () {
  const before = 'a\nb\nc\n'
  const after = 'a\nB\nc\nd\n'
  const stats = diffStats(unifiedDiff(before, after))
  assert.equal(stats.hunks, 1)
  assert.equal(stats.added, 2)
  assert.equal(stats.removed, 1)
  assert.equal(stats.lines > 0, true)
  assert.deepEqual(diffStats(''), { hunks: 0, added: 0, removed: 0, lines: 0 })
})

test('diffLines keeps the identical head and tail out of the middle', function () {
  const ops = diffLines(['a', 'b', 'c', 'd'], ['a', 'b', 'X', 'd'])
  assert.deepEqual(ops.map(function (op) { return op.type }), ['equal', 'equal', 'delete', 'insert', 'equal'])
})

// ---- fixes ----------------------------------------------------------------

test('a legacy yuan amount becomes integer Fen in the same key position', function () {
  const result = plan(SOURCE, { legacyAmountIsYuan: true })
  const fixed = JSON.parse(result.text)
  assert.equal(fixed.activities[0].amountFen, 12800)
  assert.equal(Object.prototype.hasOwnProperty.call(fixed.activities[0], 'amount'), false)
  assert.deepEqual(Object.keys(fixed.activities[0]), ['id', 'title', 'subtitle', 'amountFen', 'image'])
  assert.equal(result.changed, true)
  assert.equal(result.changes[0].rule, 'amount-legacy')
  assert.match(result.changes[0].note, /元/)
})

test('a digits string becomes a number and an absolute image loses its slash', function () {
  const result = plan(SOURCE, {
    imageExists: function (rel) { return rel === 'images/b.png' },
  })
  const fixed = JSON.parse(result.text)
  assert.equal(fixed.activities[1].amountFen, 19900)
  assert.equal(fixed.activities[1].image, 'images/b.png')
  const rules = result.changes.map(function (change) { return change.rule })
  assert.deepEqual(rules, ['amount-legacy', 'amount-fen-string', 'image-absolute'])
})

test('the image fix is not planned when the relative path does not exist', function () {
  const result = plan(SOURCE, { imageExists: function () { return false } })
  const fixed = JSON.parse(result.text)
  assert.equal(fixed.activities[1].image, '/images/b.png')
})

test('legacyAmountIsYuan:false leaves a legacy amount alone', function () {
  const result = plan(SOURCE, { legacyAmountIsYuan: false })
  const fixed = JSON.parse(result.text)
  assert.equal(fixed.activities[0].amount, 128)
  assert.equal(Object.prototype.hasOwnProperty.call(fixed.activities[0], 'amountFen'), false)
})

test('an imprecise legacy amount is never rounded into a price', function () {
  const source = JSON.stringify({ activities: [{ id: 'a', title: 'A', amount: 19.999, image: 'i.png' }] }, null, 2)
  const result = plan(source)
  assert.equal(result.changes.length, 0)
  assert.equal(result.changed, false)
  assert.equal(result.text, source)
})

test('a catalog with nothing fixable reports no change and no diff', function () {
  const source = JSON.stringify({ activities: [{ id: 'a', title: 'A', amountFen: 100, image: 'i.png' }] }, null, 2) + '\n'
  const result = plan(source)
  assert.equal(result.changes.length, 0)
  assert.equal(result.changed, false)
  assert.equal(result.text, source)
  assert.equal(unifiedDiff(source, result.text), '')
})

test('a minified source is noted because fixing reformats it', function () {
  const source = '{"activities":[{"id":"a","title":"A","amountFen":"100","image":"i.png"}]}'
  const result = plan(source)
  assert.equal(result.changed, true)
  assert.equal(result.notes.length, 1)
  assert.match(result.notes[0], /压缩/)
})

test('the planned text is valid JSON with a trailing newline kept', function () {
  const result = plan(SOURCE)
  assert.equal(result.text.endsWith('\n'), true)
  assert.doesNotThrow(function () { JSON.parse(result.text) })
})

test('a top-level array catalog is fixed in place', function () {
  const source = '[\n  {\n    "id": "a",\n    "title": "A",\n    "amount": 9.9,\n    "image": "i.png"\n  }\n]\n'
  const result = plan(source)
  const fixed = JSON.parse(result.text)
  assert.equal(fixed[0].amountFen, 990)
  assert.equal(Array.isArray(fixed), true)
})

test('a parse failure plans nothing instead of throwing', function () {
  const result = planFixes({ ok: false, error: 'bad' }, { sourceText: 'oops' })
  assert.equal(result.changed, false)
  assert.equal(result.text, 'oops')
  assert.deepEqual(result.changes, [])
})

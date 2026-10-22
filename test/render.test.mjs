// Render-scan tests: the money() rules, the glob matcher and the fs walker.

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_SCAN_PATTERNS,
  SKIP_DIRS,
  checkRenders,
  collectSourceFiles,
  normalizeRel,
  patternToRegExp,
  scanRenders,
} from '../src/render.js'

function ids(issues) {
  return issues.map(function (issue) { return issue.rule })
}

function scan(lines, path) {
  return scanRenders([{ path: path || 'pages/index.wxml', text: lines.join('\n') }])
}

// ---- glob matching --------------------------------------------------------

test('**/*.wxml matches at any depth but not another directory', function () {
  const matcher = patternToRegExp('pages/**/*.wxml')
  assert.equal(matcher.test('pages/index.wxml'), true)
  assert.equal(matcher.test('pages/detail/extra.wxml'), true)
  assert.equal(matcher.test('components/price.wxml'), false)
  assert.equal(matcher.test('pages/index.js'), false)
})

test('a single star does not cross a slash', function () {
  const matcher = patternToRegExp('pages/*.js')
  assert.equal(matcher.test('pages/a.js'), true)
  assert.equal(matcher.test('pages/deep/a.js'), false)
})

test('patterns are case-insensitive so a Windows tree matches', function () {
  assert.equal(patternToRegExp('pages/**/*.wxml').test('PAGES/Index.WXML'), true)
})

test('normalizeRel turns backslashes into forward slashes', function () {
  assert.equal(normalizeRel('pages\\index.wxml'), 'pages/index.wxml')
  assert.equal(normalizeRel('./pages/x.wxml'), 'pages/x.wxml')
})

// ---- rules ---------------------------------------------------------------

test('a hand-written /100 in a template is an error with the snippet', function () {
  const result = scan(['<view class="list">', '<text class="price">¥{{item.amountFen / 100}}</text>', '</view>'])
  assert.deepEqual(ids(result.issues), ['money-inline-divide'])
  assert.equal(result.issues[0].line, 2)
  assert.match(result.issues[0].snippet, /amountFen/)
  assert.equal(result.issues[0].severity, 'error')
})

test('the same line inside an HTML comment is not reported', function () {
  const result = scan(['<!-- <text>¥{{item.amountFen / 100}}</text> -->'])
  assert.deepEqual(ids(result.issues), [])
})

test('a JS line comment is skipped too', function () {
  const result = scan(['// const yuan = item.amountFen / 100'], 'pages/index.js')
  assert.deepEqual(ids(result.issues), [])
})

test('money() calls pass every rule', function () {
  const result = scan([
    '<text class="price">{{money(item.amountFen)}}</text>',
    '<text wx:if="{{price > 0}}">{{money(price)}}</text>',
  ])
  assert.deepEqual(ids(result.issues), [])
})

test('a template that renders amountFen raw is an error', function () {
  const result = scan(['<text>合计 {{activity.amountFen}} 分</text>'])
  assert.deepEqual(ids(result.issues), ['money-raw-fen'])
})

test('a template that renders a legacy amount raw is a warning', function () {
  const result = scan(['<text>门市价 {{activity.amount}} 元起</text>'])
  assert.deepEqual(ids(result.issues), ['money-raw-amount'])
  assert.equal(result.issues[0].severity, 'warn')
})

test('toFixed(2) on a price is an error', function () {
  const result = scan(['<text>{{item.price.toFixed(2)}}</text>'], 'components/price.wxml')
  assert.deepEqual(ids(result.issues), ['money-tofixed'])
})

test('a bare ¥ followed by an expression is an error', function () {
  const result = scan(['<text>¥{{item.fee}}</text>'], 'templates/fee.wxml')
  assert.deepEqual(ids(result.issues), ['money-symbol-bare'])
})

test('one issue per line at most: the first matching rule wins', function () {
  const result = scan(['<text>¥{{item.amountFen / 100}}</text>'])
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].rule, 'money-inline-divide')
})

test('a /100 without any amount word is left alone', function () {
  const result = scan(['<text>进度 {{done / 100}}%</text>'])
  assert.deepEqual(ids(result.issues), [])
})

test('the helper is found by definition, by export or by filename', function () {
  assert.equal(scan(['function money(fen) { return fen }'], 'utils/format.js').helper.defined, true)
  assert.equal(scan(['export const money = (fen) => fen'], 'utils/format.js').helper.defined, true)
  assert.equal(scan(['const amount = 1'], 'utils/money.js').helper.defined, true)
  assert.equal(scan(['const amount = 1'], 'utils/other.js').helper.defined, false)
})

test('checkRenders adds one warning when no helper exists at all', function () {
  const result = checkRenders([{ path: 'pages/index.wxml', text: '<view>{{money(item.amountFen)}}</view>' }], {
    hasAmounts: true,
  })
  assert.deepEqual(ids(result.issues), ['money-helper-missing'])
  assert.equal(result.issues[0].severity, 'warn')
})

test('checkRenders does not ask for a helper when there are no amounts', function () {
  const result = checkRenders([{ path: 'pages/index.wxml', text: '<view>hi</view>' }], { hasAmounts: false })
  assert.deepEqual(ids(result.issues), [])
  assert.equal(result.checkedFiles, 1)
})

test('checkedFiles counts only files with text', function () {
  const result = scanRenders([
    { path: 'a.wxml', text: '<view/>' },
    { path: 'b.wxml', text: undefined },
  ])
  assert.equal(result.checkedFiles, 1)
})

// ---- the walker -----------------------------------------------------------

test('collectSourceFiles walks the project and skips vendored trees', function () {
  const root = mkdtempSync(join(tmpdir(), 'catalog-walk-'))
  const files = [
    'pages/index.wxml',
    'pages/detail/detail.wxml',
    'components/price-tag/price-tag.wxml',
    'utils/format.js',
    'app.js',
    'node_modules/pkg/index.wxml',
    'miniprogram_npm/vant/cell.wxml',
    'dist/bundle.wxml',
    '.git/config.wxml',
  ]
  for (const rel of files) {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, '<view/>', 'utf8')
  }
  const found = collectSourceFiles(root).map(function (file) { return file.path })
  assert.deepEqual(found, [
    'components/price-tag/price-tag.wxml',
    'pages/detail/detail.wxml',
    'pages/index.wxml',
    'utils/format.js',
  ])
  assert.equal(SKIP_DIRS.has('node_modules'), true)
  assert.equal(DEFAULT_SCAN_PATTERNS.includes('utils/**/*.js'), true)
})

test('the walker honours a custom pattern list and a file cap', function () {
  const root = mkdtempSync(join(tmpdir(), 'catalog-walk-limit-'))
  for (const name of ['a.wxml', 'b.wxml', 'c.wxml']) {
    writeFileSync(join(root, name), '<view/>', 'utf8')
  }
  const onlyWxml = collectSourceFiles(root, ['*.wxml'])
  assert.equal(onlyWxml.length, 3)
  const capped = collectSourceFiles(root, ['*.wxml'], { maxFiles: 2 })
  assert.equal(capped.length, 2)
  const none = collectSourceFiles(root, ['*.js'])
  assert.equal(none.length, 0)
})

test('a file over the size cap is skipped instead of read', function () {
  const root = mkdtempSync(join(tmpdir(), 'catalog-walk-size-'))
  writeFileSync(join(root, 'big.wxml'), '<view/>', 'utf8')
  const found = collectSourceFiles(root, ['*.wxml'], { maxBytes: 2 })
  assert.equal(found.length, 0)
})

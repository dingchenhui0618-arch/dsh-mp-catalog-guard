// CLI tests: exit codes, output shapes, the report file, and apply. The demo
// project in examples/ is the same fixture the README and the screenshot use.

import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { main, parseCliArgs } from '../src/cli.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEMO = join(ROOT, 'examples', 'demo')

async function run(argv, cwd) {
  const out = []
  const err = []
  const code = await main(argv, {
    cwd: cwd || ROOT,
    stdout: function (text) { out.push(text) },
    stderr: function (text) { err.push(text) },
  })
  return { code: code, out: out.join('\n'), err: err.join('\n') }
}

function cleanProject() {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-cli-clean-'))
  mkdirSync(join(dir, 'images'), { recursive: true })
  mkdirSync(join(dir, 'utils'), { recursive: true })
  mkdirSync(join(dir, 'pages'), { recursive: true })
  writeFileSync(join(dir, 'images', 'a.png'), 'png', 'utf8')
  writeFileSync(join(dir, 'utils', 'format.js'), 'function money(fen) { return fen }\nmodule.exports = { money }\n', 'utf8')
  writeFileSync(join(dir, 'pages', 'index.wxml'), '<text>{{money(item.amountFen)}}</text>\n', 'utf8')
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({
    activities: [{ id: 'a', title: '秋季套餐', subtitle: '含茶位', amountFen: 1990, image: 'images/a.png' }],
  }, null, 2) + '\n', 'utf8')
  return dir
}

test('--help prints the usage and exits 0', async function () {
  const result = await run(['--help'])
  assert.equal(result.code, 0)
  assert.match(result.out, /用法：/)
  assert.match(result.out, /--catalog/)
  assert.match(result.out, /--apply/)
})

test('an unknown option is a usage error, exit 2', async function () {
  const result = await run(['--nope'])
  assert.equal(result.code, 2)
  assert.match(result.err, /参数错误/)
  assert.match(result.err, /用法：/)
})

test('two directories are a usage error, exit 2', async function () {
  const result = await run(['a', 'b'])
  assert.equal(result.code, 2)
  assert.match(result.err, /只接受一个目录参数/)
})

test('the demo project exits 1 and prints the issues', async function () {
  const result = await run(['examples/demo'])
  assert.equal(result.code, 1)
  assert.match(result.out, /内容目录检查/)
  assert.match(result.out, /amount-fen-float/)
  assert.match(result.out, /模式：dry-run/)
  assert.match(result.out, /修复 diff/)
})

test('--json prints one parseable report', async function () {
  const result = await run(['examples/demo', '--json'])
  assert.equal(result.code, 1)
  const report = JSON.parse(result.out)
  assert.equal(report.entries, 6)
  assert.ok(report.counts.error > 0)
  assert.ok(report.fixes.count > 0)
  assert.equal(report.mode, 'dry-run')
})

test('--quiet prints the conclusion only', async function () {
  const result = await run(['examples/demo', '--quiet'])
  assert.equal(result.code, 1)
  assert.match(result.out, /catalog\.json · 6 条活动 · 错误/)
  assert.equal(result.out.includes('diff'), false)
})

test('--no-render drops the template findings', async function () {
  const full = JSON.parse((await run(['examples/demo', '--json'])).out)
  const without = JSON.parse((await run(['examples/demo', '--json', '--no-render'])).out)
  assert.ok(without.counts.error < full.counts.error)
  assert.equal(without.issues.some(function (issue) { return issue.rule.indexOf('money-') === 0 }), false)
})

test('--report writes a standalone HTML file', async function () {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-cli-report-'))
  const target = join(dir, 'report.html')
  const result = await run(['examples/demo', '--report', target])
  assert.equal(result.code, 1)
  assert.match(result.err, /HTML 报告/)
  assert.equal(existsSync(target), true)
  const html = readFileSync(target, 'utf8')
  assert.match(html, /<!doctype html>/)
  assert.match(html, /amount-fen-float/)
})

test('dry-run leaves the catalog byte-identical', async function () {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-cli-dry-'))
  cpSync(DEMO, dir, { recursive: true })
  const before = readFileSync(join(dir, 'catalog.json'), 'utf8')
  await run([dir])
  assert.equal(readFileSync(join(dir, 'catalog.json'), 'utf8'), before)
})

test('--apply writes the fixable entries and then exits 0 when nothing is left', async function () {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-cli-apply-'))
  mkdirSync(join(dir, 'images'), { recursive: true })
  writeFileSync(join(dir, 'images', 'a.png'), 'png', 'utf8')
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({
    activities: [{ id: 'a', title: 'A', amount: 128, image: 'images/a.png' }],
  }, null, 2) + '\n', 'utf8')
  const result = await run([dir, '--apply', '--no-render'])
  assert.equal(result.code, 0)
  const written = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'))
  assert.equal(written.activities[0].amountFen, 12800)
  // the report describes the file as it is after the write, not before it
  assert.match(result.out, /错误 0 · 警告 0 · 信息 0/)
  assert.match(result.out, /已自动修复 1 处/)
})

test('a clean project exits 0 and says so', async function () {
  const result = await run([cleanProject()])
  assert.equal(result.code, 0)
  assert.match(result.out, /没有发现问题/)
})

test('a missing catalog is an error report, exit 1', async function () {
  const empty = mkdtempSync(join(tmpdir(), 'catalog-cli-empty-'))
  const result = await run([empty])
  assert.equal(result.code, 1)
  assert.match(result.out, /catalog-unreadable/)
})

test('--catalog points at a different file', async function () {
  const dir = cleanProject()
  const renamed = join(dir, 'data.json')
  cpSync(join(dir, 'catalog.json'), renamed)
  const result = await run([dir, '--catalog', 'data.json'])
  assert.equal(result.code, 0)
  assert.match(result.out, /data\.json/)
})

test('parseCliArgs applies defaults and reads flags', function () {
  const parsed = parseCliArgs(['examples/demo', '--apply'])
  assert.deepEqual(parsed.positionals, ['examples/demo'])
  assert.equal(parsed.values.apply, true)
  assert.equal(parsed.values.json, false)
  assert.equal(parsed.values.theme, 'auto')
  assert.equal(parseCliArgs(['--no-render']).values['no-render'], true)
})

test('the bin script runs end to end', function () {
  const result = spawnSync(process.execPath, [join(ROOT, 'bin', 'catalog-guard.mjs'), 'examples/demo', '--quiet'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /6 条活动/)
  assert.equal(result.stderr, '')
})

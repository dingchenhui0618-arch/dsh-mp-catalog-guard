// Render checks: is every price on screen produced by money()?
//
// Two halves. `scanRenders` is pure — it takes file texts and returns issues.
// `collectSourceFiles` is the fs walker that feeds it. Splitting them keeps the
// rules testable without a fixture tree, while the walker stays the only place
// that touches disk.
//
// The patterns are deliberately narrow. A linter that cries wolf on every
// `{{total}}` gets switched off within a day, so each rule needs a shape that is
// unambiguous in a mini-program template: a literal /100, a toFixed(2) on an
// amount, a ¥ immediately followed by a mustache, or a raw `amountFen`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { makeIssue } from './rules.js'

export const DEFAULT_SCAN_PATTERNS = [
  'pages/**/*.wxml',
  'components/**/*.wxml',
  'templates/**/*.wxml',
  'pages/**/*.js',
  'components/**/*.js',
  'utils/**/*.js',
]

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'miniprogram_npm',
  'unpackage',
  'dist',
  'coverage',
])

export const MAX_FILES = 400
export const MAX_FILE_BYTES = 512 * 1024

const MONEY_CALL = /\bmoney\s*\(/
const AMOUNT_WORD = /\b(?:amount|price|fee|cost|total)\w*/i
const DIVIDE_100 = /\/\s*100\b/
const TO_FIXED = /toFixed\s*\(\s*2\s*\)/
const RAW_FEN = /\{\{[^}]*\bamountFen\b/
const RAW_AMOUNT = /\{\{[^}]*\.(?:amount|price|fee|cost)\b/i
const BARE_YUAN = /[¥￥]\s*\{\{/
const HELPER_DEFINITION = new RegExp(
  '(?:function\\s+money\\s*\\(|\\b(?:const|let|var)\\s+money\\s*=' +
  '|export\\s+(?:async\\s+)?function\\s+money\\b|money\\s*:\\s*(?:function|\\())',
)

/** `pages/**\/*.wxml` → RegExp over forward-slash relative paths. */
export function patternToRegExp(pattern) {
  const source = String(pattern)
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
  return new RegExp('^' + source + '$', 'i')
}

export function normalizeRel(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '')
}

function isCommentLine(line) {
  return line.startsWith('<!--') || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')
}

/**
 * Check every line of every source file for a price that bypassed money().
 *
 * @param {Array<{path: string, text: string}>} files
 * @returns {{issues: any[], helper: {defined: boolean, where: string[]}, checkedFiles: number}}
 */
export function scanRenders(files) {
  const issues = []
  const helperWhere = []
  let checkedFiles = 0

  for (const file of files) {
    if (typeof file.text !== 'string') continue
    checkedFiles += 1
    const relPath = normalizeRel(file.path)
    const lines = file.text.split(/\r?\n/)
    const baseName = relPath.slice(relPath.lastIndexOf('/') + 1)

    if (HELPER_DEFINITION.test(file.text) || baseName === 'money.js') helperWhere.push(relPath)

    lines.forEach(function (raw, index) {
      const line = raw.trim()
      if (line.length === 0 || isCommentLine(line)) return
      const hasMoney = MONEY_CALL.test(raw)
      if (hasMoney) return
      const mentionsAmount = AMOUNT_WORD.test(raw)
      const where = { file: relPath, line: index + 1, snippet: line.length > 120 ? line.slice(0, 120) + ' …' : line }

      if (mentionsAmount && DIVIDE_100.test(raw)) {
        issues.push(makeIssue('money-inline-divide', {
          file: where.file,
          line: where.line,
          snippet: where.snippet,
          message: '模板里手写 /100 换单位，和 money() 的口径会分叉。',
        }))
        return
      }
      if (mentionsAmount && TO_FIXED.test(raw)) {
        issues.push(makeIssue('money-tofixed', {
          file: where.file,
          line: where.line,
          snippet: where.snippet,
          message: '用 toFixed(2) 拼价格：分转元的格式化和四舍五入都应交给 money()。',
        }))
        return
      }
      if (BARE_YUAN.test(raw)) {
        issues.push(makeIssue('money-symbol-bare', {
          file: where.file,
          line: where.line,
          snippet: where.snippet,
          message: '¥ 后面直接跟表达式，符号和数字没有一起交给 money()。',
        }))
        return
      }
      if (RAW_FEN.test(raw)) {
        issues.push(makeIssue('money-raw-fen', {
          file: where.file,
          line: where.line,
          snippet: where.snippet,
          message: '直接渲染 amountFen（单位是分），页面上会显示成 100 倍。',
        }))
        return
      }
      if (RAW_AMOUNT.test(raw)) {
        issues.push(makeIssue('money-raw-amount', {
          file: where.file,
          line: where.line,
          snippet: where.snippet,
          message: '直接渲染金额字段，没有统一走 money()。',
        }))
      }
    })
  }

  return {
    issues: issues,
    helper: { defined: helperWhere.length > 0, where: helperWhere },
    checkedFiles: checkedFiles,
  }
}

/**
 * Walk the project and read the files matching `patterns`.
 *
 * Directories that cannot be part of a mini-program's own source
 * (node_modules, miniprogram_npm, dist, dot-directories) are skipped, and the
 * file count and size are capped: a validator must not become the slowest part
 * of a build because someone pointed it at a monorepo.
 *
 * @param {string} rootDir
 * @param {string[]} [patterns]
 * @param {{maxFiles?: number, maxBytes?: number}} [options]
 * @returns {Array<{path: string, text: string}>}
 */
export function collectSourceFiles(rootDir, patterns, options) {
  const settings = options || {}
  const matchers = (Array.isArray(patterns) && patterns.length > 0 ? patterns : DEFAULT_SCAN_PATTERNS)
    .map(patternToRegExp)
  const maxFiles = Number.isInteger(settings.maxFiles) && settings.maxFiles > 0 ? settings.maxFiles : MAX_FILES
  const maxBytes = Number.isInteger(settings.maxBytes) && settings.maxBytes > 0 ? settings.maxBytes : MAX_FILE_BYTES
  const found = []

  function walk(dir) {
    if (found.length >= maxFiles) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      return
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = normalizeRel(relative(rootDir, full))
      if (!matchers.some(function (matcher) { return matcher.test(rel) })) continue
      let text
      try {
        const info = statSync(full)
        if (info.size > maxBytes) continue
        text = readFileSync(full, 'utf8')
      } catch (error) {
        continue
      }
      found.push({ path: rel, text: text })
    }
  }

  walk(rootDir)
  found.sort(function (a, b) { return a.path.localeCompare(b.path) })
  return found
}

/**
 * The whole render check: helper presence plus per-line bypasses.
 *
 * @param {Array<{path: string, text: string}>} files
 * @param {{hasAmounts?: boolean}} [options]
 */
export function checkRenders(files, options) {
  const settings = options || {}
  const scanned = scanRenders(files)
  const issues = scanned.issues.slice()
  // A project with no template files at all has nothing to render prices in;
  // warning about a missing helper there would be noise on a catalog-only repo.
  if (settings.hasAmounts !== false && scanned.checkedFiles > 0 && !scanned.helper.defined) {
    issues.push(makeIssue('money-helper-missing', {
      message: '扫了 ' + scanned.checkedFiles + ' 个模板/脚本文件，没找到 money() 的定义或引入；金额格式化口径无法保证统一。',
    }))
  }
  return {
    issues: issues,
    helper: scanned.helper,
    checkedFiles: scanned.checkedFiles,
    files: files.map(function (file) { return normalizeRel(file.path) }),
  }
}

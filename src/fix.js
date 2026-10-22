// Fix planning and the unified diff.
//
// The contract with the human is narrow: this module only rewrites what has one
// unambiguous target. A string of digits in `amountFen` becomes that number; a
// `¥19.90`-style `amount` becomes 1990 Fen because the field name says yuan; a
// leading `/` on an image goes away only when the relative path actually exists.
// Everything else stays in the report for a person to decide.
//
// Serialisation keeps the file's own style — indent, EOL, trailing newline —
// because a whitespace-only rewrite of a 400-line catalog would bury the three
// real changes in the diff.

import { LEGACY_AMOUNT_FIELDS, hasOwn, isPlainObject, toFenAmount } from './catalog.js'

/** First indented line tells us the file's indent unit; minified files get two spaces. */
export function detectIndent(text) {
  if (typeof text !== 'string') return '  '
  const match = text.match(/\n([ \t]+)["}\]\[]/)
  if (match === null) return '  '
  return match[1]
}

export function detectEol(text) {
  return typeof text === 'string' && text.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
}

export function isMinified(text) {
  return typeof text === 'string' && text.length > 0 && text.indexOf('\n') < 0
}

/**
 * @param {any} data
 * @param {string} sourceText the file the data came from; supplies formatting
 */
export function serializeCatalog(data, sourceText) {
  const indent = detectIndent(sourceText)
  const eol = detectEol(sourceText)
  // JSON.stringify always joins with LF; a CRLF file gets its own line ending
  // back so the diff is about content, not about the checkout.
  const body = JSON.stringify(data, null, indent).split('\n').join(eol)
  if (typeof sourceText === 'string' && sourceText.endsWith('\n')) return body + eol
  return body
}

/** LF lines, CR stripped: content comparison must not depend on line endings. */
export function splitLines(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map(function (line) { return line.endsWith('\r') ? line.slice(0, -1) : line })
}

/**
 * LCS diff over two line arrays.
 *
 * The dynamic-programming table is O(n·m); past 4M cells (a 2000×2000 middle)
 * the function degrades to "replace the whole middle", which is still a valid
 * patch and keeps a pathological input from freezing the process.
 *
 * @returns {Array<{type: 'equal'|'delete'|'insert', text: string}>}
 */
export function lcsOps(a, b) {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map(function (text) { return { type: 'insert', text: text } })
  if (m === 0) return a.map(function (text) { return { type: 'delete', text: text } })
  if (n * m > 4_000_000) {
    return a.map(function (text) { return { type: 'delete', text: text } })
      .concat(b.map(function (text) { return { type: 'insert', text: text } }))
  }
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ type: 'delete', text: a[i] })
      i += 1
    } else {
      ops.push({ type: 'insert', text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', text: a[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'insert', text: b[j] })
    j += 1
  }
  return ops
}

/** Diff both arrays without diffing the identical head and tail. */
export function diffLines(a, b) {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1

  const ops = []
  for (let i = 0; i < prefix; i++) ops.push({ type: 'equal', text: a[i] })
  for (const op of lcsOps(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix))) ops.push(op)
  for (let i = a.length - suffix; i < a.length; i++) ops.push({ type: 'equal', text: a[i] })
  return ops
}

/**
 * Group changed ops into hunks with `context` unchanged lines around them.
 * @returns {string[]} hunk bodies, each starting with its `@@` header line
 */
export function buildHunks(ops, context) {
  const changed = []
  ops.forEach(function (op, index) {
    if (op.type !== 'equal') changed.push(index)
  })
  if (changed.length === 0) return []

  const groups = []
  let group = [changed[0]]
  for (let k = 1; k < changed.length; k++) {
    const index = changed[k]
    if (index - group[group.length - 1] <= context * 2 + 1) group.push(index)
    else {
      groups.push(group)
      group = [index]
    }
  }
  groups.push(group)

  const oldBefore = new Array(ops.length + 1).fill(0)
  const newBefore = new Array(ops.length + 1).fill(0)
  for (let i = 0; i < ops.length; i++) {
    oldBefore[i + 1] = oldBefore[i] + (ops[i].type === 'insert' ? 0 : 1)
    newBefore[i + 1] = newBefore[i] + (ops[i].type === 'delete' ? 0 : 1)
  }

  const hunks = []
  for (const indices of groups) {
    const start = Math.max(0, indices[0] - context)
    const end = Math.min(ops.length, indices[indices.length - 1] + 1 + context)
    let oldCount = 0
    let newCount = 0
    const lines = []
    for (let i = start; i < end; i++) {
      const op = ops[i]
      if (op.type === 'equal') {
        oldCount += 1
        newCount += 1
        lines.push(' ' + op.text)
      } else if (op.type === 'delete') {
        oldCount += 1
        lines.push('-' + op.text)
      } else {
        newCount += 1
        lines.push('+' + op.text)
      }
    }
    const oldStart = oldCount === 0 ? oldBefore[start] : oldBefore[start] + 1
    const newStart = newCount === 0 ? newBefore[start] : newBefore[start] + 1
    hunks.push('@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@\n' + lines.join('\n'))
  }
  return hunks
}

/**
 * Unified diff between two texts.
 *
 * Both sides come from this plugin, which preserves the source's trailing
 * newline, so the "\ No newline at end of file" marker cannot apply; the output
 * is intentionally plain `patch -p1` / `git apply` shaped rather than a byte
 * stream that still needs markers.
 *
 * @param {string} oldText
 * @param {string} newText
 * @param {{path?: string, context?: number}} [options]
 * @returns {string} '' when nothing changed
 */
export function unifiedDiff(oldText, newText, options) {
  const settings = options || {}
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const sameLength = a.length === b.length
  if (sameLength && a.every(function (line, index) { return line === b[index] })) return ''
  const path = typeof settings.path === 'string' && settings.path.length > 0 ? settings.path : 'catalog.json'
  const context = Number.isInteger(settings.context) && settings.context >= 0 ? settings.context : 3
  const hunks = buildHunks(diffLines(a, b), context)
  if (hunks.length === 0) return ''
  return '--- a/' + path + '\n+++ b/' + path + '\n' + hunks.join('\n') + '\n'
}

/** `{"hunks": 2, "added": 3, "removed": 2, "lines": 14}` for the panel and the CLI. */
export function diffStats(diff) {
  const stats = { hunks: 0, added: 0, removed: 0, lines: 0 }
  if (typeof diff !== 'string' || diff.length === 0) return stats
  const lines = splitLines(diff)
  stats.lines = lines.length
  for (const line of lines) {
    if (line.startsWith('@@')) stats.hunks += 1
    else if (line.startsWith('+') && !line.startsWith('+++')) stats.added += 1
    else if (line.startsWith('-') && !line.startsWith('---')) stats.removed += 1
  }
  return stats
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Plan the deterministic subset of fixes.
 *
 * @param {{data: any, activities: any[], container: {kind: string, key: string}}} parsed
 * @param {{sourceText: string, legacyAmountIsYuan?: boolean,
 *          imageExists?: (relPath: string) => boolean}} options
 * @returns {{data: any, text: string, changes: any[], changed: boolean, notes: string[]}}
 */
export function planFixes(parsed, options) {
  const settings = options || {}
  const sourceText = typeof settings.sourceText === 'string' ? settings.sourceText : ''
  const legacyAmountIsYuan = settings.legacyAmountIsYuan !== false
  const imageExists = typeof settings.imageExists === 'function' ? settings.imageExists : function () { return false }
  const notes = []
  const changes = []

  if (!parsed || !parsed.ok || !isPlainObject(parsed.container)) {
    return { data: undefined, text: sourceText, changes: changes, changed: false, notes: notes }
  }

  const next = cloneJson(parsed.data)
  const activities = Array.isArray(next) ? next : next[parsed.container.key]

  activities.forEach(function (entry, index) {
    if (!isPlainObject(entry)) return
    const entryId = typeof entry.id === 'string' ? entry.id : undefined
    let current = entry

    // 1) legacy yuan field → amountFen, keeping the key's position.
    const legacyKeys = LEGACY_AMOUNT_FIELDS.filter(function (key) { return hasOwn(current, key) })
    if (!hasOwn(current, 'amountFen') && legacyKeys.length === 1 && legacyAmountIsYuan) {
      const key = legacyKeys[0]
      const before = current[key]
      const converted = toFenAmount(before)
      if (converted !== undefined && converted.exact) {
        const rebuilt = {}
        for (const name of Object.keys(current)) {
          if (name === key) rebuilt.amountFen = converted.fen
          else rebuilt[name] = current[name]
        }
        current = rebuilt
        changes.push({
          rule: 'amount-legacy',
          entry: index,
          entryId: entryId,
          field: 'amountFen',
          before: before,
          after: converted.fen,
          note: '按元换算为分',
        })
      }
    }

    // 2) digits stored as a string → number.
    if (hasOwn(current, 'amountFen') && typeof current.amountFen === 'string' && /^\d+$/.test(current.amountFen.trim())) {
      const before = current.amountFen
      const after = Number(before.trim())
      const rebuilt = {}
      for (const name of Object.keys(current)) {
        if (name === 'amountFen') rebuilt.amountFen = after
        else rebuilt[name] = current[name]
      }
      current = rebuilt
      changes.push({
        rule: 'amount-fen-string',
        entry: index,
        entryId: entryId,
        field: 'amountFen',
        before: before,
        after: after,
        note: '字符串转数字',
      })
    }

    // 3) leading slash on an image path whose relative form exists.
    if (typeof current.image === 'string' && current.image.startsWith('/')) {
      const before = current.image
      const stripped = before.replace(/^\/+/, '')
      if (imageExists(stripped)) {
        const rebuilt = {}
        for (const name of Object.keys(current)) {
          if (name === 'image') rebuilt.image = stripped
          else rebuilt[name] = current[name]
        }
        current = rebuilt
        changes.push({
          rule: 'image-absolute',
          entry: index,
          entryId: entryId,
          field: 'image',
          before: before,
          after: stripped,
          note: '去掉开头斜杠',
        })
      }
    }

    activities[index] = current
  })

  const text = serializeCatalog(next, sourceText)
  if (changes.length > 0 && isMinified(sourceText)) {
    notes.push('原目录是压缩成一行的 JSON，应用修复会同时把它排版成缩进格式。')
  }
  return {
    data: next,
    text: text,
    changes: changes,
    changed: changes.length > 0 && text !== sourceText,
    notes: notes,
  }
}

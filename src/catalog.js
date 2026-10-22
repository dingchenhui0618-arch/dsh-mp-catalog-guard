// Catalog model: parse `catalog.json` and check every activity on its own.
//
// Pure functions only — no fs, no clock. The caller hands in the raw text so
// line numbers in the report point at the file the human will open.

import { makeIssue } from './rules.js'

export const DEFAULT_REQUIRED_FIELDS = ['id', 'title', 'amountFen', 'image']

/** Fields a catalog might still carry from the "price in yuan" era. */
export const LEGACY_AMOUNT_FIELDS = ['amount', 'price', 'fee', 'cost']

/** Top-level keys accepted as "the activity array". */
export const CONTAINER_KEYS = ['activities', 'items', 'list', 'entries', 'products']

/** 100 000 元 — above this a Fen value is far more likely a yuan value. */
export const SUSPICIOUS_FEN = 10_000_000

/** 副标题短于这个长度就不查重（"限时"这种词重复是正常的）。 */
export const DEFAULT_MIN_DUPLICATE_LENGTH = 6

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function isBlank(value) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim().length === 0) return true
  return false
}

function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(value)
  }
}

/**
 * Parse the catalog text.
 *
 * Accepts a top-level array, or an object holding the array under one of
 * CONTAINER_KEYS. The container is remembered because serialising a fix has to
 * put the activities back where it found them.
 *
 * @param {string} text
 * @returns {{ok: true, data: any, activities: any[], container: {kind: 'array'|'key', key: string}}
 *          | {ok: false, error: string, data?: any}}
 */
export function parseCatalog(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: '目录文件是空的。' }
  }
  let data
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    const message = String((error && error.message) || error)
    return { ok: false, error: '不是合法 JSON：' + message }
  }
  if (Array.isArray(data)) {
    return { ok: true, data: data, activities: data, container: { kind: 'array', key: '' } }
  }
  if (isPlainObject(data)) {
    for (const key of CONTAINER_KEYS) {
      if (Array.isArray(data[key])) {
        return { ok: true, data: data, activities: data[key], container: { kind: 'key', key: key } }
      }
    }
    return {
      ok: false,
      error: '顶层对象里没有活动数组（支持 ' + CONTAINER_KEYS.join(' / ') + '）。',
      data: data,
    }
  }
  return { ok: false, error: '顶层必须是数组，或含活动数组的对象。', data: data }
}

/**
 * Interpret a yuan-denominated value as Fen.
 *
 * The unit assumption is the point of the rule: a field named `amount` or
 * `price` holds yuan, because that is what those names meant before the money
 * contract existed. `exact` is false when the value has more than two decimals,
 * where rounding would silently change the price.
 *
 * @param {unknown} value number, or a string like "19.9" / "¥19.90" / "1,999"
 * @returns {{fen: number, exact: boolean} | undefined}
 */
export function toFenAmount(value) {
  let number = value
  if (typeof value === 'string') {
    const cleaned = value.replace(/[¥￥,，\s元]/g, '')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined
    number = Number(cleaned)
  }
  if (typeof number !== 'number' || !Number.isFinite(number)) return undefined
  const fen = Math.round(number * 100)
  return { fen: fen, exact: Math.abs(fen / 100 - number) < 1e-9 }
}

/** Whitespace and punctuation removed, lowercased: "限时 5 折！" === "限时5折". */
export function normalizeCopy(text) {
  if (typeof text !== 'string') return ''
  return text
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）()[\]【】《》!?,.;:~·—\-]/g, '')
    .toLowerCase()
}

/**
 * Line numbers for entries, so the report points at a real line.
 *
 * JSON.parse throws positions away, so the only honest way back is a text
 * search: an entry is located when exactly one line carries its id (or, when it
 * has no id, its title). Ambiguous values stay unlocated rather than pointing at
 * the wrong line.
 *
 * @param {string} text
 * @param {any[]} activities
 * @returns {Array<number|undefined>} 1-based line per entry
 */
export function locateEntries(text, activities) {
  const result = new Array(activities.length).fill(undefined)
  if (typeof text !== 'string' || text.length === 0) return result
  const lines = text.split('\n')
  if (lines.length > 20000) return result
  activities.forEach(function (entry, index) {
    if (!isPlainObject(entry)) return
    for (const candidate of [entry.id, entry.title]) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue
      const needle = JSON.stringify(candidate)
      let hits = 0
      let line = 0
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(needle) >= 0) {
          hits += 1
          line = i + 1
          if (hits > 1) break
        }
      }
      if (hits === 1) {
        result[index] = line
        return
      }
    }
  })
  return result
}

/**
 * @param {any[]} activities
 * @param {{text?: string, file?: string, requiredFields?: string[],
 *          minDuplicateLength?: number}} [options]
 */
export function checkCatalog(activities, options) {
  const settings = options || {}
  const file = typeof settings.file === 'string' ? settings.file : 'catalog.json'
  const text = typeof settings.text === 'string' ? settings.text : ''
  const required = Array.isArray(settings.requiredFields) && settings.requiredFields.length > 0
    ? settings.requiredFields.slice()
    : DEFAULT_REQUIRED_FIELDS.slice()
  const minDuplicate = Number.isInteger(settings.minDuplicateLength) && settings.minDuplicateLength >= 0
    ? settings.minDuplicateLength
    : DEFAULT_MIN_DUPLICATE_LENGTH

  const lines = locateEntries(text, activities)
  const issues = []
  const seenIds = new Map()
  const seenTitles = new Map()
  const seenSubtitles = new Map()

  activities.forEach(function (entry, index) {
    const line = lines[index]
    if (!isPlainObject(entry)) {
      issues.push(makeIssue('entry-not-object', {
        file: file,
        line: line,
        entry: index,
        message: '第 ' + (index + 1) + ' 条不是对象，无法校验。',
      }))
      return
    }
    const base = { file: file, line: line, entry: index, entryId: typeof entry.id === 'string' ? entry.id : undefined }

    // id: presence, type, uniqueness
    if (isBlank(entry.id)) {
      issues.push(makeIssue('field-missing', Object.assign({}, base, {
        field: 'id',
        message: '第 ' + (index + 1) + ' 条没有 id，无法稳定引用。',
      })))
    } else if (typeof entry.id !== 'string') {
      issues.push(makeIssue('field-missing', Object.assign({}, base, {
        field: 'id',
        message: 'id 必须是字符串，现在是 ' + describe(entry.id) + '。',
      })))
    } else if (seenIds.has(entry.id)) {
      issues.push(makeIssue('id-duplicate', Object.assign({}, base, {
        field: 'id',
        message: 'id "' + entry.id + '" 与第 ' + (seenIds.get(entry.id) + 1) + ' 条重复。',
      })))
    } else {
      seenIds.set(entry.id, index)
    }

    // title: presence, type, duplicate copy
    if (isBlank(entry.title)) {
      issues.push(makeIssue('field-missing', Object.assign({}, base, {
        field: 'title',
        message: '第 ' + (index + 1) + ' 条没有标题。',
      })))
    } else if (typeof entry.title !== 'string') {
      issues.push(makeIssue('field-missing', Object.assign({}, base, {
        field: 'title',
        message: 'title 必须是字符串，现在是 ' + describe(entry.title) + '。',
      })))
    } else {
      const key = normalizeCopy(entry.title)
      if (key.length > 0) {
        if (seenTitles.has(key)) {
          issues.push(makeIssue('title-duplicate', Object.assign({}, base, {
            field: 'title',
            message: '标题「' + entry.title + '」与第 ' + (seenTitles.get(key) + 1) + ' 条重复。',
          })))
        } else {
          seenTitles.set(key, index)
        }
      }
    }

    // subtitle: duplicate copy only; short strings repeat legitimately
    if (typeof entry.subtitle === 'string' && entry.subtitle.trim().length > 0) {
      const key = normalizeCopy(entry.subtitle)
      if (key.length >= minDuplicate) {
        if (seenSubtitles.has(key)) {
          issues.push(makeIssue('subtitle-duplicate', Object.assign({}, base, {
            field: 'subtitle',
            message: '副标题「' + entry.subtitle + '」与第 ' + (seenSubtitles.get(key) + 1) + ' 条重复。',
          })))
        } else {
          seenSubtitles.set(key, index)
        }
      }
    }

    // any other field the caller declared required
    for (const field of required) {
      if (field === 'id' || field === 'title' || field === 'amountFen' || field === 'image') continue
      if (isBlank(entry[field])) {
        issues.push(makeIssue('field-missing', Object.assign({}, base, {
          field: field,
          message: '缺少必填字段 ' + field + '。',
        })))
      }
    }

    checkAmount(entry, base, issues)
  })

  return { issues: issues, entryLines: lines }
}

function checkAmount(entry, base, issues) {
  const hasFen = hasOwn(entry, 'amountFen')
  const legacyKeys = LEGACY_AMOUNT_FIELDS.filter(function (key) { return hasOwn(entry, key) })

  if (hasFen) {
    if (legacyKeys.length > 0) {
      issues.push(makeIssue('amount-duplicate-field', Object.assign({}, base, {
        field: 'amountFen',
        message: '同时存在 amountFen 与 ' + legacyKeys.join(' / ') + '，对账时容易看错字段。',
      })))
    }
    const value = entry.amountFen
    if (typeof value === 'string') {
      if (/^\d+$/.test(value.trim())) {
        issues.push(makeIssue('amount-fen-string', Object.assign({}, base, {
          field: 'amountFen',
          fixable: true,
          message: 'amountFen 写成了字符串 "' + value + '"，数字才能直接参与金额计算。',
        })))
      } else {
        issues.push(makeIssue('amount-fen-string', Object.assign({}, base, {
          field: 'amountFen',
          hint: '如果这是元，请 ×100 换成整数分。',
          message: 'amountFen 写成了字符串 "' + value + '"，无法当整数分使用。',
        })))
      }
      return
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(makeIssue('amount-unreadable', Object.assign({}, base, {
        field: 'amountFen',
        message: 'amountFen 不是有限数字，现在是 ' + describe(value) + '。',
      })))
      return
    }
    if (!Number.isInteger(value)) {
      issues.push(makeIssue('amount-fen-float', Object.assign({}, base, {
        field: 'amountFen',
        hint: '分必须是整数；如果想要 19.90 元，这里是 1990。',
        message: 'amountFen = ' + value + '，不是整数分。',
      })))
      return
    }
    if (value < 0) {
      issues.push(makeIssue('amount-fen-negative', Object.assign({}, base, {
        field: 'amountFen',
        message: 'amountFen = ' + value + '，金额不能为负。',
      })))
      return
    }
    if (value === 0) {
      issues.push(makeIssue('amount-fen-zero', Object.assign({}, base, {
        field: 'amountFen',
        message: 'amountFen = 0。免费活动可以忽略，定价漏填则要补。',
      })))
      return
    }
    if (value > SUSPICIOUS_FEN) {
      issues.push(makeIssue('amount-fen-suspicious', Object.assign({}, base, {
        field: 'amountFen',
        hint: '如果本意是 ' + value + ' 元，这里应是 ' + (value * 100) + ' 分。',
        message: 'amountFen = ' + value + '（' + (value / 100) + ' 元），大得像是把元当成了分。',
      })))
    }
    return
  }

  if (legacyKeys.length === 0) {
    issues.push(makeIssue('amount-missing', Object.assign({}, base, {
      field: 'amountFen',
      hint: '金额必须以整数分写在 amountFen 里。',
      message: '没有金额字段：既没有 amountFen，也没有 ' + LEGACY_AMOUNT_FIELDS.join(' / ') + '。',
    })))
    return
  }

  const key = legacyKeys[0]
  const converted = toFenAmount(entry[key])
  if (converted === undefined) {
    issues.push(makeIssue('amount-unreadable', Object.assign({}, base, {
      field: key,
      message: key + ' = ' + describe(entry[key]) + '，无法解析成金额。',
    })))
  } else if (!converted.exact) {
    issues.push(makeIssue('amount-imprecise', Object.assign({}, base, {
      field: key,
      hint: '超过两位小数的金额不能自动换算，请人工确认到分。',
      message: key + ' = ' + describe(entry[key]) + '，换算成分会丢失精度。',
    })))
  } else {
    issues.push(makeIssue('amount-legacy', Object.assign({}, base, {
      field: key,
      fixable: true,
      message: '金额写在 ' + key + ' 里（' + describe(entry[key]) + '），没有 amountFen；按元换算应为 ' + converted.fen + ' 分。',
    })))
  }

  if (legacyKeys.length > 1) {
    issues.push(makeIssue('amount-duplicate-field', Object.assign({}, base, {
      field: legacyKeys.join('/'),
      message: '同时存在 ' + legacyKeys.join(' / ') + ' 多个金额字段，哪个才是真价格不明确。',
    })))
  }
}

// The rule table: one id, one severity, one human label.
//
// Severity lives here and nowhere else so a rule can never report "error" in
// one code path and "warn" in another, and so the panel can render a label
// without a second lookup table that drifts.

/**
 * @typedef {'error'|'warn'|'info'} Severity
 * @type {Record<string, {severity: Severity, label: string, fixable?: boolean}>}
 */
export const RULES = {
  // ---- 目录本身 ---------------------------------------------------------
  'catalog-unreadable': { severity: 'error', label: '目录文件读不到' },
  'catalog-parse': { severity: 'error', label: '目录不是合法 JSON' },
  'catalog-shape': { severity: 'error', label: '目录结构不是活动数组' },
  'catalog-empty': { severity: 'warn', label: '目录里没有任何活动' },
  'entry-not-object': { severity: 'error', label: '条目不是对象' },

  // ---- 必填与唯一性 -----------------------------------------------------
  'field-missing': { severity: 'error', label: '必填字段缺失' },
  'id-duplicate': { severity: 'error', label: '活动 id 重复' },
  'title-duplicate': { severity: 'warn', label: '标题重复' },
  'subtitle-duplicate': { severity: 'warn', label: '副标题重复' },

  // ---- 金额 -------------------------------------------------------------
  'amount-missing': { severity: 'error', label: '缺少金额字段' },
  'amount-legacy': { severity: 'error', label: '金额没有用 amountFen', fixable: true },
  'amount-unreadable': { severity: 'error', label: '金额不是数字' },
  'amount-imprecise': { severity: 'error', label: '金额超过两位小数' },
  'amount-fen-string': { severity: 'error', label: 'amountFen 是字符串', fixable: true },
  'amount-fen-float': { severity: 'error', label: 'amountFen 不是整数' },
  'amount-fen-negative': { severity: 'error', label: 'amountFen 为负数' },
  'amount-fen-zero': { severity: 'warn', label: 'amountFen 为 0' },
  'amount-fen-suspicious': { severity: 'warn', label: 'amountFen 大得可疑' },
  'amount-duplicate-field': { severity: 'warn', label: '同时存在多个金额字段' },

  // ---- 渲染 -------------------------------------------------------------
  'money-inline-divide': { severity: 'error', label: '模板里手写 /100' },
  'money-raw-fen': { severity: 'error', label: '模板直接渲染分' },
  'money-raw-amount': { severity: 'warn', label: '模板直接渲染金额字段' },
  'money-symbol-bare': { severity: 'error', label: '¥ 后面没有走 money()' },
  'money-tofixed': { severity: 'error', label: '用 toFixed 拼价格' },
  'money-helper-missing': { severity: 'warn', label: '全项目找不到 money()' },

  // ---- 图片 -------------------------------------------------------------
  'image-missing': { severity: 'error', label: '图片不存在' },
  'image-absolute': { severity: 'error', label: '图片用了绝对路径', fixable: true },
  'image-outside': { severity: 'warn', label: '图片路径跑到项目外' },
  'image-remote': { severity: 'info', label: '远程图片无法离线校验' },
}

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 }

export const SEVERITY_LABEL = { error: '错误', warn: '警告', info: '信息' }

/** @returns {{severity: Severity, label: string, fixable?: boolean}} */
export function ruleMeta(rule) {
  return RULES[rule] || { severity: 'warn', label: String(rule) }
}

/**
 * Build one issue record. Every field is optional except the rule and message,
 * so a caller never has to invent a location it does not know.
 *
 * @param {string} rule
 * @param {{message: string, file?: string, line?: number, entry?: number,
 *          entryId?: string, field?: string, fixable?: boolean, hint?: string,
 *          snippet?: string, severity?: Severity}} props
 */
export function makeIssue(rule, props) {
  const meta = ruleMeta(rule)
  const issue = {
    rule: rule,
    severity: props.severity || meta.severity,
    label: meta.label,
    message: String(props.message === undefined ? meta.label : props.message),
  }
  if (typeof props.file === 'string' && props.file.length > 0) issue.file = props.file
  if (Number.isInteger(props.line) && props.line > 0) issue.line = props.line
  if (Number.isInteger(props.entry) && props.entry >= 0) issue.entry = props.entry
  if (typeof props.entryId === 'string' && props.entryId.length > 0) issue.entryId = props.entryId
  if (typeof props.field === 'string' && props.field.length > 0) issue.field = props.field
  if (typeof props.hint === 'string' && props.hint.length > 0) issue.hint = props.hint
  if (typeof props.snippet === 'string' && props.snippet.length > 0) issue.snippet = props.snippet
  issue.fixable = props.fixable === true
  return issue
}

/** Stable order: errors first, then by file then line then rule. */
export function compareIssues(a, b) {
  const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  if (bySeverity !== 0) return bySeverity
  const byFile = String(a.file || '').localeCompare(String(b.file || ''))
  if (byFile !== 0) return byFile
  const byLine = (a.line || 0) - (b.line || 0)
  if (byLine !== 0) return byLine
  const byRule = String(a.rule).localeCompare(String(b.rule))
  if (byRule !== 0) return byRule
  return String(a.message).localeCompare(String(b.message))
}

/** `catalog.json:24` when a line is known, `catalog.json#3` otherwise. */
export function formatLocation(issue) {
  const file = typeof issue.file === 'string' && issue.file.length > 0 ? issue.file : ''
  if (Number.isInteger(issue.line)) return file + ':' + issue.line
  if (Number.isInteger(issue.entry)) return file + '#' + (issue.entry + 1)
  return file
}

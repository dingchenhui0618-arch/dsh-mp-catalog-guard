// The whole check, minus the plumbing.
//
// `checkProject` is the single entry point shared by the tool, the HTTP route
// and the CLI. It receives an IO surface (real fs, the harness fs service, or an
// in-memory map), so there is exactly one code path that decides what counts as
// an issue and exactly one definition of what "clean" means.

import { isAbsolute, join, relative, resolve } from 'node:path'
import { checkImages } from './assets.js'
import { DEFAULT_REQUIRED_FIELDS, checkCatalog, parseCatalog } from './catalog.js'
import { diffStats, planFixes, unifiedDiff } from './fix.js'
import { MAX_FILES, checkRenders, normalizeRel } from './render.js'
import { assembleReport } from './report.js'
import { makeIssue } from './rules.js'

export const DEFAULT_CATALOG_FILE = 'catalog.json'

function messageOf(error) {
  const message = String((error && error.message) || error || '')
  return message.length > 0 ? message : '未知错误'
}

/** Inside the project → relative; outside → absolute, because a lie is worse. */
export function displayPath(projectDir, absolutePath) {
  const rel = relative(projectDir, absolutePath)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return normalizeRel(absolutePath)
  return normalizeRel(rel)
}

/**
 * @param {{projectDir?: string, catalog?: string, apply?: boolean, render?: boolean,
 *          requiredFields?: string[], imageBase?: string, scanPatterns?: string[],
 *          legacyAmountIsYuan?: boolean, minDuplicateLength?: number}} request
 * @param {{readText: (p: string) => Promise<string>, writeText: (p: string, t: string) => Promise<void>,
 *          exists: (p: string) => boolean, listFiles: (root: string, p?: string[]) => Promise<any[]>,
 *          now?: () => Date}} io
 */
export async function checkProject(request, io) {
  const settings = request || {}
  const started = Date.now()
  const projectDir = resolve(settings.projectDir || process.cwd())
  const requested = typeof settings.catalog === 'string' && settings.catalog.trim().length > 0
    ? settings.catalog.trim()
    : DEFAULT_CATALOG_FILE
  const catalogPath = isAbsolute(requested) ? requested : join(projectDir, requested)
  const catalogName = displayPath(projectDir, catalogPath)
  const requiredFields = Array.isArray(settings.requiredFields) && settings.requiredFields.length > 0
    ? settings.requiredFields
    : DEFAULT_REQUIRED_FIELDS
  const imageBase = typeof settings.imageBase === 'string' ? settings.imageBase : ''
  const legacyAmountIsYuan = settings.legacyAmountIsYuan !== false
  const mode = settings.apply === true ? 'apply' : 'dry-run'
  const issues = []
  const notes = []
  const scan = { render: settings.render !== false, requiredFields: requiredFields.slice(), imageBase: imageBase }

  function now() {
    return typeof io.now === 'function' ? io.now() : new Date()
  }

  function finish(extra) {
    return assembleReport(Object.assign({
      projectDir: projectDir,
      catalog: catalogName,
      catalogPath: catalogPath,
      mode: mode,
      issues: issues,
      notes: notes,
      scan: scan,
      at: now(),
      durationMs: Date.now() - started,
    }, extra))
  }

  let text
  try {
    text = await io.readText(catalogPath)
  } catch (error) {
    issues.push(makeIssue('catalog-unreadable', {
      file: catalogName,
      message: '读不到 ' + catalogPath + '：' + messageOf(error),
    }))
    return finish({ parsed: false, entries: 0 })
  }

  function imageExists(relPath) {
    try {
      return io.exists(join(projectDir, normalizeRel(relPath))) === true
    } catch (error) {
      return false
    }
  }

  /**
   * Everything that depends on the catalog text itself. Called twice when
   * `apply` succeeds: once on what is on disk, once on what was just written, so
   * the reported issues are the ones that remain rather than the fixed ones.
   */
  function collect(sourceText) {
    const parsed = parseCatalog(sourceText)
    if (!parsed.ok) {
      return {
        parsed: parsed,
        activities: [],
        entryLines: [],
        issues: [makeIssue(parsed.data === undefined ? 'catalog-parse' : 'catalog-shape', {
          file: catalogName,
          message: parsed.error,
        })],
      }
    }
    const catalogChecked = checkCatalog(parsed.activities, {
      text: sourceText,
      file: catalogName,
      requiredFields: requiredFields,
      minDuplicateLength: settings.minDuplicateLength,
    })
    const collected = catalogChecked.issues.slice()
    if (parsed.activities.length === 0) {
      collected.push(makeIssue('catalog-empty', {
        file: catalogName,
        message: '目录里一条活动都没有。',
      }))
    }
    const images = checkImages(parsed.activities, {
      file: catalogName,
      imageBase: imageBase,
      entryLines: catalogChecked.entryLines,
      exists: imageExists,
    })
    return {
      parsed: parsed,
      activities: parsed.activities,
      entryLines: catalogChecked.entryLines,
      issues: collected.concat(images),
    }
  }

  let state = collect(text)
  for (const issue of state.issues) issues.push(issue)
  if (!state.parsed.ok) return finish({ parsed: false, entries: 0 })

  let render
  if (settings.render !== false) {
    let files = []
    try {
      files = await io.listFiles(projectDir, settings.scanPatterns)
    } catch (error) {
      notes.push('模板扫描失败，只检查了目录：' + messageOf(error))
    }
    if (Array.isArray(files) && files.length >= MAX_FILES) {
      notes.push('模板文件达到扫描上限 ' + MAX_FILES + ' 个，可能还有文件没扫到。')
    }
    render = checkRenders(Array.isArray(files) ? files : [], { hasAmounts: state.activities.length > 0 })
    for (const issue of render.issues) issues.push(issue)
    if (render.files.length > 60) render = Object.assign({}, render, { files: render.files.slice(0, 60) })
  }

  const fixes = planFixes(state.parsed, {
    sourceText: text,
    legacyAmountIsYuan: legacyAmountIsYuan,
    imageExists: imageExists,
  })
  const diff = fixes.changed ? unifiedDiff(text, fixes.text, { path: catalogName }) : ''

  let applied = false
  let applyError
  if (mode === 'apply') {
    if (fixes.changed) {
      try {
        await io.writeText(catalogPath, fixes.text)
        applied = true
      } catch (error) {
        applyError = messageOf(error)
      }
    } else {
      notes.push('没有可自动修复的项，文件未改动。')
    }
  }

  if (applied) {
    // The file just changed under us: re-read what it now says and report that.
    const after = collect(fixes.text)
    issues.length = 0
    for (const issue of after.issues) issues.push(issue)
    if (render !== undefined) {
      for (const issue of render.issues) issues.push(issue)
    }
    state = after
    notes.push('已自动修复 ' + fixes.changes.length + ' 处；上面的问题清单是写回之后的状态。')
  }

  for (const note of fixes.notes) notes.push(note)
  if (issues.some(function (issue) { return issue.rule === 'amount-legacy' })) {
    notes.push('amount / price 这类旧字段按「元」理解并换算成分；若它们本来就是分，用 legacyAmountIsYuan: false 关掉自动换算。')
  }

  return finish({
    parsed: true,
    entries: state.activities.length,
    fixes: { changes: fixes.changes },
    diff: diff,
    applied: applied,
    applyError: applyError,
    render: render,
  })
}

/** Re-exported so the CLI and the tool agree on dir names. */
export { DEFAULT_REQUIRED_FIELDS, diffStats }

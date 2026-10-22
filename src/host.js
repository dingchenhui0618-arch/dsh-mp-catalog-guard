// Host half of dsh-mp-catalog-guard.
//
// Two surfaces, one implementation:
//
//   * an `mp_catalog_guard` tool, so the agent can check a mini-program's
//     catalog as part of its own work instead of grepping prices by eye;
//   * an HTTP route serving the panel HTML, the standalone report page, and a
//     rescan/apply pair the panel buttons call.
//
// Everything is local. No model call, no network: a catalog and a diff of it
// never leave the machine.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import cssText from './client-css.cjs'
import { DEFAULT_CATALOG_FILE, checkProject } from './check.js'
import { nodeIo } from './io.js'
import { renderPanelHtml, renderReportPage } from './panel-html.js'
import { summaryText } from './report.js'
import { collectSourceFiles } from './render.js'

export const name = 'dsh-mp-catalog-guard'
export const inject = ['webServer', 'tools']

const ROUTE = '/dsh-mp-catalog-guard'
const HISTORY_KEEP = 20
const MAX_DIFF_PERSISTED = 200_000

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

function packageVersion() {
  try {
    const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    return JSON.parse(text).version
  } catch (error) {
    return undefined
  }
}

function friendly(error, fallback) {
  const message = String((error && error.message) || error || '')
  return message.length > 0 ? message : fallback
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise(function (resolve) {
    let raw = ''
    req.on('data', function (chunk) {
      raw += chunk
      if (raw.length > 1048576) req.destroy()
    })
    req.on('end', function () {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {})
      } catch (error) {
        resolve({})
      }
    })
    req.on('error', function () {
      resolve({})
    })
  })
}

export function segmentsOf(url) {
  const path = String(url || '').split('?')[0]
  if (path === ROUTE || path === ROUTE + '/') return []
  if (path.indexOf(ROUTE + '/') !== 0) return []
  return path.slice(ROUTE.length + 1).split('/').filter(function (part) { return part.length > 0 })
}

function themeOf(url) {
  const query = String(url || '').split('?')[1] || ''
  const match = query.match(/(?:^|&)theme=(dark|light|auto)(?:&|$)/)
  return match === null ? 'auto' : match[1]
}

/** History entries stay lean: only the numbers ever get displayed. */
function historyEntry(report) {
  return {
    at: report.at,
    projectDir: report.projectDir,
    catalog: report.catalog,
    entries: report.entries,
    counts: report.counts,
    ok: report.ok,
    fixes: report.fixes.count,
    applied: report.fixes.applied,
    durationMs: report.durationMs,
  }
}

/** The persisted copy: identical except for a capped diff. */
export function leanReport(report) {
  if (report === undefined || report === null) return undefined
  const copy = JSON.parse(JSON.stringify(report))
  if (copy.fixes && typeof copy.fixes.diff === 'string' && copy.fixes.diff.length > MAX_DIFF_PERSISTED) {
    copy.fixes.diff = copy.fixes.diff.slice(0, MAX_DIFF_PERSISTED) + '\n…（diff 过长，已截断）'
    copy.fixes.truncated = true
  }
  if (copy.render && Array.isArray(copy.render.files) && copy.render.files.length > 20) {
    copy.render.files = copy.render.files.slice(0, 20)
  }
  return copy
}

/**
 * @param {object} ctx cordis context
 * @param {{projectDir?: string, catalogFile?: string, requiredFields?: string[],
 *          imageBase?: string, scanPatterns?: string[], render?: boolean,
 *          legacyAmountIsYuan?: boolean, minDuplicateLength?: number,
 *          dataDir?: string}} [config]
 */
export function apply(ctx, config) {
  const settings = config && typeof config === 'object' ? config : {}
  const baseDir = typeof settings.projectDir === 'string' && settings.projectDir.length > 0
    ? resolvePath(settings.projectDir)
    : process.cwd()
  const catalogFile = typeof settings.catalogFile === 'string' && settings.catalogFile.length > 0
    ? settings.catalogFile
    : DEFAULT_CATALOG_FILE
  const requiredFields = Array.isArray(settings.requiredFields) && settings.requiredFields.length > 0
    ? settings.requiredFields
    : undefined
  const imageBase = typeof settings.imageBase === 'string' ? settings.imageBase : ''
  const scanPatterns = Array.isArray(settings.scanPatterns) && settings.scanPatterns.length > 0
    ? settings.scanPatterns
    : undefined
  const renderEnabled = settings.render !== false
  const legacyAmountIsYuan = settings.legacyAmountIsYuan !== false
  const minDuplicateLength = Number.isInteger(settings.minDuplicateLength) ? settings.minDuplicateLength : undefined
  const dataDir = typeof settings.dataDir === 'string' && settings.dataDir.length > 0
    ? settings.dataDir
    : join(dshHome(), 'mp-catalog-guard')
  const statePath = join(dataDir, 'state.json')
  const version = packageVersion()

  // Prefer the harness filesystem service so reads and the single write go
  // through whatever policy the session already agreed to. Its absence (a bare
  // host, the tests) is the only reason to fall back to node:fs.
  const fsService = ctx.get('fs')
  const io = fsService === undefined
    ? nodeIo()
    : {
        async readText(path) {
          const target = await fsService.resolve(path)
          return fsService.readText(target)
        },
        async writeText(path, text) {
          const target = await fsService.resolve(path)
          await fsService.writeText(target, text)
        },
        exists(path) {
          try {
            return existsSync(path)
          } catch (error) {
            return false
          }
        },
        listFiles(root, patterns) {
          return Promise.resolve(collectSourceFiles(root, patterns))
        },
        now() {
          return new Date()
        },
      }

  const persisted = (function () {
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8') || '{}')
      return {
        latest: parsed.latest !== null && typeof parsed.latest === 'object' ? parsed.latest : undefined,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        stats: parsed.stats !== null && typeof parsed.stats === 'object' ? parsed.stats : undefined,
      }
    } catch (error) {
      return { latest: undefined, history: [], stats: undefined }
    }
  })()

  const stats = Object.assign({ runs: 0, clean: 0, dirty: 0, applied: 0, failed: 0 }, persisted.stats)
  const history = persisted.history.slice(-HISTORY_KEEP)
  let latest = persisted.latest
  let lastProjectDir = latest !== undefined && typeof latest.projectDir === 'string' ? latest.projectDir : undefined

  function saveState() {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
      writeFileSync(statePath, JSON.stringify({
        stats: stats,
        latest: leanReport(latest),
        history: history,
      }, null, 2))
    } catch (error) {
      // Persistence is best effort: losing the panel's memory must never fail a
      // check that already produced a correct answer.
    }
  }

  async function resolveProjectDir(args, exec) {
    if (typeof args.projectDir === 'string' && args.projectDir.trim().length > 0) {
      return resolvePath(baseDir, args.projectDir.trim())
    }
    if (exec !== undefined && exec.agent !== undefined) {
      const workingDirectory = ctx.get('workingDirectory')
      if (workingDirectory !== undefined && typeof workingDirectory.ensure === 'function') {
        try {
          const dir = await workingDirectory.ensure(exec.agent, exec.signal)
          if (typeof dir === 'string' && dir.length > 0) return dir
        } catch (error) {
          // Fall through to the plugin default.
        }
      }
    }
    return lastProjectDir !== undefined ? lastProjectDir : baseDir
  }

  async function runCheck(args, exec) {
    const safe = args !== undefined && args !== null && typeof args === 'object' ? args : {}
    const projectDir = await resolveProjectDir(safe, exec)
    const report = await checkProject({
      projectDir: projectDir,
      catalog: typeof safe.catalog === 'string' && safe.catalog.trim().length > 0 ? safe.catalog.trim() : catalogFile,
      apply: safe.apply === true,
      render: renderEnabled && safe.render !== false,
      requiredFields: Array.isArray(safe.requiredFields) && safe.requiredFields.length > 0 ? safe.requiredFields : requiredFields,
      imageBase: imageBase,
      scanPatterns: scanPatterns,
      legacyAmountIsYuan: legacyAmountIsYuan,
      minDuplicateLength: minDuplicateLength,
    }, io)

    lastProjectDir = report.projectDir
    stats.runs += 1
    if (report.clean) stats.clean += 1
    else stats.dirty += 1
    if (report.fixes.applied) stats.applied += 1
    latest = report
    history.push(historyEntry(report))
    while (history.length > HISTORY_KEEP) history.shift()
    saveState()
    return report
  }

  function statePayload() {
    return {
      stats: stats,
      latest: leanReport(latest),
      panelHtml: renderPanelHtml(latest),
      history: history.slice(-12).reverse(),
      config: {
        projectDir: lastProjectDir !== undefined ? lastProjectDir : baseDir,
        catalogFile: catalogFile,
        render: renderEnabled,
        version: version,
      },
    }
  }

  // The tool is the plugin. Without it there is nothing to expose, so a failure
  // here is visible rather than contained.
  ctx.effect(function () {
    return ctx.tools.register({
      name: 'mp_catalog_guard',
      description: [
        '校验微信小程序的内容目录 catalog.json，并给出一份可直接应用的修复 diff（默认 dry-run）。',
        '检查：金额是否为整数 amountFen（拒绝浮点、负数和残留的 amount/price 旧字段）、',
        '模板里的价格是否统一走 money()（拦 /100、toFixed(2)、直接渲染 amountFen、¥ 裸表达式）、',
        '必填字段（默认 id/title/amountFen/image）、id 与文案重复、图片路径是否存在。',
        '默认只读：返回问题清单和 unified diff，不写文件；apply: true 才把可自动修复的项写回。',
        '适合在改动活动、调价或发版前跑一次，避免浮点金额和漏字段只有到真机才暴露。',
      ].join(''),
      parameters: {
        type: 'object',
        properties: {
          projectDir: {
            type: 'string',
            description: '小程序项目根目录（含 catalog.json）。默认用当前会话工作目录。',
          },
          catalog: {
            type: 'string',
            description: '目录文件，默认 catalog.json；相对 projectDir 或绝对路径。',
          },
          apply: {
            type: 'boolean',
            description: '默认 false（dry-run，只出 diff）。true 时把可自动修复的项写回目录文件。',
          },
          render: {
            type: 'boolean',
            description: '默认 true：同时扫描 wxml/js 里 money() 的用法。',
          },
          requiredFields: {
            type: 'array',
            items: { type: 'string' },
            description: '覆盖必填字段列表，默认 id / title / amountFen / image。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          description: '检查报告：counts 是结论，issues 是问题清单，fixes.diff 是可应用的 unified diff。',
        },
        render: function (args, value) {
          return [{ type: 'text', text: summaryText(value) }]
        },
      },
      isConcurrencySafe: function () {
        // A check reads files; only `apply` writes, and a write to the same file
        // from two calls in one batch would be a race the caller owns.
        return true
      },
      presentCall: function (args) {
        const safe = args !== undefined && args !== null && typeof args === 'object' ? args : {}
        return {
          card: 'generic',
          title: 'mp_catalog_guard',
          kind: 'read',
          rawInput: args,
          locations: [{ path: typeof safe.catalog === 'string' ? safe.catalog : DEFAULT_CATALOG_FILE }],
        }
      },
      execute: async function (args, exec) {
        try {
          return await runCheck(args, exec)
        } catch (error) {
          stats.failed += 1
          throw new Error('[dsh-mp-catalog-guard] ' + friendly(error, '检查失败'))
        }
      },
    })
  })

  // The panel and its route are the disposable half: a changed webServer
  // contract must cost the user the panel, not the tool.
  ctx.effect(function () {
    let disposeRoute
    try {
      disposeRoute = ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async function (req, res) {
          try {
            const parts = segmentsOf(req.url)
            if (req.method === 'GET' && (parts.length === 0 || parts[0] === 'state')) {
              sendJson(res, 200, statePayload())
              return
            }
            if (req.method === 'GET' && parts[0] === 'report.html') {
              const page = renderReportPage(latest, {
                css: cssText,
                theme: themeOf(req.url),
                version: version,
              })
              res.statusCode = 200
              res.setHeader('content-type', 'text/html; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.end(page)
              return
            }
            if (req.method === 'POST') {
              await readBody(req)
              if (parts.length === 1 && parts[0] === 'rescan') {
                const report = await runCheck({ projectDir: lastProjectDir })
                sendJson(res, 200, { ok: true, report: leanReport(report) })
                return
              }
              if (parts.length === 1 && parts[0] === 'apply') {
                const report = await runCheck({ projectDir: lastProjectDir, apply: true })
                sendJson(res, 200, { ok: report.fixes.applied, report: leanReport(report) })
                return
              }
              sendJson(res, 404, { error: 'unknown method' })
              return
            }
            sendJson(res, 404, { error: 'not found' })
          } catch (error) {
            sendJson(res, 500, { error: friendly(error, 'unknown error') })
          }
        },
      })
    } catch (error) {
      disposeRoute = undefined
    }
    return function () {
      if (typeof disposeRoute === 'function') disposeRoute()
    }
  })
}

/** Exposed for the test suite: the route layout is part of the contract. */
export const internals = {
  ROUTE: ROUTE,
  segmentsOf: segmentsOf,
  themeOf: themeOf,
  leanReport: leanReport,
  historyEntry: historyEntry,
}

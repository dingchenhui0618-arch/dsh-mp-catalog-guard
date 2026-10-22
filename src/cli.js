#!/usr/bin/env node
// CLI half: the same check the plugin runs, usable from a terminal or a build.
//
// Exit codes: 0 clean, 1 issues found (or a write failed), 2 bad usage.

import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { DEFAULT_CATALOG_FILE, checkProject } from './check.js'
import { nodeIo } from './io.js'
import { renderReportPage } from './panel-html.js'
import { summaryText } from './report.js'

export const USAGE = [
  'mp-catalog-guard —— 校验微信小程序内容目录',
  '',
  '用法：',
  '  mp-catalog-guard [目录] [选项]',
  '',
  '选项：',
  '  --catalog <文件>     目录文件，默认 ' + DEFAULT_CATALOG_FILE + '（相对 [目录]）',
  '  --apply             把可自动修复的项写回目录（默认 dry-run，只出 diff）',
  '  --json              输出完整报告 JSON',
  '  --no-render         不扫描 wxml/js 里的 money() 用法',
  '  --report <文件>     额外写出一份自包含 HTML 报告',
  '  --theme <名称>      HTML 报告配色：auto | light | dark，默认 auto',
  '  --quiet             只输出结论，不列问题',
  '  --help              显示这段说明',
  '',
  '示例：',
  '  mp-catalog-guard examples/demo',
  '  mp-catalog-guard . --apply --report catalog-report.html',
].join('\n')

/** @param {string[]} argv */
export function parseCliArgs(argv) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      catalog: { type: 'string' },
      apply: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'no-render': { type: 'boolean', default: false },
      report: { type: 'string' },
      theme: { type: 'string', default: 'auto' },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  return parsed
}

/**
 * @param {string[]} argv
 * @param {{cwd?: string, stdout?: (text: string) => void, stderr?: (text: string) => void,
 *          io?: any, version?: string}} [environment]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, environment) {
  const settings = environment || {}
  const out = settings.stdout || function (text) { process.stdout.write(text + '\n') }
  const err = settings.stderr || function (text) { process.stderr.write(text + '\n') }
  let parsed
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    err('参数错误：' + String((error && error.message) || error))
    err('')
    err(USAGE)
    return 2
  }
  const flags = parsed.values
  if (flags.help) {
    out(USAGE)
    return 0
  }
  if (parsed.positionals.length > 1) {
    err('只接受一个目录参数，收到：' + parsed.positionals.join(' '))
    return 2
  }

  const projectDir = resolve(settings.cwd || process.cwd(), parsed.positionals[0] || '.')
  const io = settings.io || nodeIo()

  let report
  try {
    report = await checkProject({
      projectDir: projectDir,
      catalog: flags.catalog,
      apply: flags.apply === true,
      render: flags['no-render'] !== true,
    }, io)
  } catch (error) {
    err('检查失败：' + String((error && error.message) || error))
    return 2
  }

  if (flags.json) {
    out(JSON.stringify(report, null, 2))
  } else if (flags.quiet) {
    const counts = report.counts
    out(report.catalog + ' · ' + report.entries + ' 条活动 · 错误 ' + counts.error +
      ' · 警告 ' + counts.warn + ' · 信息 ' + counts.info +
      (report.fixes.count > 0 ? ' · 可自动修复 ' + report.fixes.count : ''))
  } else {
    out(summaryText(report, { maxIssues: 200, maxDiffLines: 400 }))
  }

  if (typeof flags.report === 'string' && flags.report.length > 0) {
    const path = resolve(settings.cwd || process.cwd(), flags.report)
    const html = renderReportPage(report, {
      theme: flags.theme === 'dark' ? 'dark' : (flags.theme === 'light' ? 'light' : 'auto'),
      version: settings.version,
    })
    try {
      await io.writeText(path, html)
      err('HTML 报告：' + path)
    } catch (error) {
      err('写 HTML 报告失败：' + String((error && error.message) || error))
      return 1
    }
  }

  if (report.applyError) {
    err('写入失败：' + report.applyError)
    return 1
  }
  return report.counts.error > 0 ? 1 : 0
}

#!/usr/bin/env node
// Renders the panel for real and screenshots it.
//
// The HTML is not a mock-up: scripts/demo.mjs runs the actual checker over
// examples/demo, and renderReportPage() wraps the same markup and stylesheet the
// conversation panel shows. Headless Chrome then does what a browser does, and
// the page is captured at its measured height so nothing is cut off.
//
// Usage: node scripts/screenshot.mjs [--out docs/screenshot-1.png] [--theme dark]
//                                   [--width 900]
//
// Requires a local Chrome/Chromium. The CDP plumbing below is deliberate: the
// --screenshot flag captures only the viewport, and a report cut off mid-diff is
// not evidence of anything.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReportPage } from '../src/panel-html.js'
import { runDemo } from './demo.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CDP_PORT = 9339

function parse(argv) {
  const options = { out: 'docs/screenshot-1.png', theme: 'dark', width: 900 }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--out') options.out = argv[++i]
    else if (flag === '--theme') options.theme = argv[++i]
    else if (flag === '--width') options.width = Number(argv[++i])
  }
  return options
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list')
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(function (target) { return target.type === 'page' && target.webSocketDebuggerUrl })
        if (page !== undefined) return page.webSocketDebuggerUrl
      }
    } catch (error) {
      // devtools not listening yet
    }
    await sleep(150)
  }
  return undefined
}

class Cdp {
  constructor(url) {
    this.url = url
    this.socket = undefined
    this.nextId = 0
    this.pending = new Map()
  }

  async open() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(function () { reject(new Error('devtools websocket timed out')) }, 5000)
      this.socket.addEventListener('open', function () { clearTimeout(timer); resolve() })
      this.socket.addEventListener('error', function () { clearTimeout(timer); reject(new Error('devtools websocket failed')) })
    })
    this.socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        return
      }
      if (message.id === undefined) return
      const slot = this.pending.get(message.id)
      if (slot === undefined) return
      this.pending.delete(message.id)
      if (message.error) slot.reject(new Error(message.error.message))
      else slot.resolve(message.result)
    })
  }

  send(method, params) {
    const id = this.nextId + 1
    this.nextId = id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve, reject: reject })
      this.socket.send(JSON.stringify({ id: id, method: method, params: params || {} }))
    })
  }

  close() {
    try {
      this.socket.close()
    } catch (error) {
      // already gone
    }
  }
}

/**
 * Load the page, measure it, set the viewport to exactly that height, capture.
 * @returns {Promise<number>} captured height in CSS pixels
 */
async function captureFullPage(chrome, url, outPath, width) {
  const profileDir = mkdtempSync(join(root, '_verify', 'chrome-'))
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profileDir,
    'about:blank',
  ], { stdio: 'ignore' })
  try {
    const wsUrl = await waitForDevtools(CDP_PORT, 12000)
    if (wsUrl === undefined) throw new Error('devtools 没有起来（端口 ' + CDP_PORT + '）')
    const cdp = new Cdp(wsUrl)
    await cdp.open()
    try {
      await cdp.send('Page.enable')
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: width, height: 1000, deviceScaleFactor: 2, mobile: false,
      })
      await cdp.send('Page.navigate', { url: url })
      for (let attempt = 0; attempt < 40; attempt++) {
        await sleep(120)
        const ready = await cdp.send('Runtime.evaluate', {
          expression: 'document.readyState', returnByValue: true,
        })
        if (ready.result !== undefined && ready.result.value === 'complete') break
      }
      const measured = await cdp.send('Runtime.evaluate', {
        expression: 'Math.ceil(document.documentElement.getBoundingClientRect().height)',
        returnByValue: true,
      })
      const measuredHeight = Number(measured.result === undefined ? 0 : measured.result.value)
      const height = Math.max(600, Math.min(8000, Number.isFinite(measuredHeight) ? measuredHeight : 1200))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: width, height: height, deviceScaleFactor: 2, mobile: false,
      })
      await sleep(200)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
      return height
    } finally {
      cdp.close()
    }
  } finally {
    try {
      child.kill()
    } catch (error) {
      // already gone
    }
    await sleep(150)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch (error) {
      // a leftover profile directory is not worth failing over
    }
  }
}

const options = parse(process.argv.slice(2))
const report = await runDemo()

const previewHtml = join(root, 'docs', 'panel-preview.html')
mkdirSync(dirname(previewHtml), { recursive: true })
const version = (function () {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  } catch (error) {
    return undefined
  }
})()
writeFileSync(previewHtml, renderReportPage(report, {
  theme: options.theme, version: version, panel: true,
}), 'utf8')

const chrome = chromePath()
if (chrome === undefined) {
  process.stderr.write('找不到 Chrome；HTML 已写到 ' + previewHtml + '，请手动截图。\n')
  process.exitCode = 1
} else {
  const outPath = join(root, options.out)
  mkdirSync(dirname(outPath), { recursive: true })
  mkdirSync(join(root, '_verify'), { recursive: true })
  const url = 'file:///' + previewHtml.replace(/\\/g, '/')
  const height = await captureFullPage(chrome, url, outPath, options.width)
  process.stdout.write('截图：' + outPath + '（' + options.width + '×' + height + ' CSS px，2 倍缩放）\n')
  process.stdout.write('HTML：' + previewHtml + '\n')
  process.stdout.write('错误 ' + report.counts.error + ' · 警告 ' + report.counts.warn +
    ' · 信息 ' + report.counts.info + ' · 活动 ' + report.entries + '\n')
}

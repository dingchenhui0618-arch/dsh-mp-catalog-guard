#!/usr/bin/env node
// Regenerates examples/demo — a small mini-program with exactly the problems
// this plugin exists to catch — and runs the checker over it.
//
// The fixture is generated rather than hand-maintained so the line numbers
// quoted in the README stay true: run this script, read the output.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkProject } from '../src/check.js'
import { nodeIo } from '../src/io.js'
import { renderReportPage } from '../src/panel-html.js'
import { summaryText } from '../src/report.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DEMO_DIR = join(root, 'examples', 'demo')

// 1×1 transparent PNG: enough for an existence check, nothing to license.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const CATALOG = `{
  "version": 2,
  "updatedAt": "2026-10-18",
  "activities": [
    {
      "id": "act_autumn_3",
      "title": "秋季套餐 3 人",
      "subtitle": "含茶位与甜品",
      "amountFen": 19.9,
      "image": "images/autumn.png"
    },
    {
      "id": "act_lunch_2",
      "title": "工作日双人午餐",
      "subtitle": "含茶位与甜品",
      "amount": 128,
      "image": "images/lunch.png"
    },
    {
      "id": "act_autumn_3",
      "title": "秋季套餐 3 人",
      "subtitle": "限时供应",
      "amountFen": "19900",
      "image": "/images/autumn.png"
    },
    {
      "id": "act_night_1",
      "title": "夜宵拼盘",
      "amountFen": 6800,
      "image": "images/missing-snack.png"
    },
    {
      "id": "act_free_1",
      "title": "到店试饮",
      "subtitle": "到店即可",
      "amountFen": 0,
      "image": "images/lunch.png"
    },
    {
      "id": "act_remote_1",
      "title": "联名礼盒",
      "amountFen": 39800,
      "image": "https://cdn.example.com/box.png"
    }
  ]
}
`

const INDEX_WXML = `<view class="list">
  <block wx:for="{{activities}}" wx:key="id">
    <view class="card" bindtap="openDetail" data-id="{{item.id}}">
      <image class="cover" src="{{item.image}}" mode="aspectFill" />
      <view class="title">{{item.title}}</view>
      <!-- 历史写法，别照抄：<text>¥{{item.amountFen / 100}}</text> -->
      <text class="price">¥{{item.amountFen / 100}}</text>
      <text class="sub">{{item.subtitle}}</text>
    </view>
  </block>
</view>
`

const DETAIL_WXML = `<view class="detail">
  <view class="price">{{money(activity.amountFen)}}</view>
  <text class="hint">已含服务费，合计 {{activity.amountFen}} 分</text>
  <text class="strike">门市价 ¥{{activity.amount}} 起</text>
  <text class="sub">{{activity.subtitle}}</text>
</view>
`

const PRICE_TAG_WXML = `<view class="tag">
  <text class="num">{{money(value)}}</text>
</view>
`

const FORMAT_JS = `// 金额一律以「分」的整数存储，只有这里把分转成 ¥12.30 这种展示形式。
function money(fen) {
  const rounded = Math.round(fen)
  const yuan = Math.floor(rounded / 100)
  const cents = rounded % 100
  return '¥' + yuan + '.' + (cents < 10 ? '0' + cents : String(cents))
}

module.exports = { money }
`

const APP_JSON = `{
  "pages": ["pages/index", "pages/detail"],
  "window": {
    "navigationBarTitleText": "示例活动"
  }
}
`

const FILES = [
  ['catalog.json', CATALOG, 'utf8'],
  ['app.json', APP_JSON, 'utf8'],
  ['pages/index.wxml', INDEX_WXML, 'utf8'],
  ['pages/detail.wxml', DETAIL_WXML, 'utf8'],
  ['components/price-tag/price-tag.wxml', PRICE_TAG_WXML, 'utf8'],
  ['utils/format.js', FORMAT_JS, 'utf8'],
  ['images/autumn.png', Buffer.from(PNG_BASE64, 'base64'), 'binary'],
  ['images/lunch.png', Buffer.from(PNG_BASE64, 'base64'), 'binary'],
]

export function buildDemo() {
  for (const [relPath, content, encoding] of FILES) {
    const full = join(DEMO_DIR, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, encoding === 'binary' ? undefined : 'utf8')
  }
  return DEMO_DIR
}

export async function runDemo() {
  buildDemo()
  return checkProject({ projectDir: DEMO_DIR, render: true }, nodeIo())
}

const invokedDirectly = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const report = await runDemo()
  process.stdout.write(summaryText(report, { maxIssues: 200, maxDiffLines: 200 }) + '\n')
  const preview = join(root, 'docs', 'panel-preview.html')
  mkdirSync(dirname(preview), { recursive: true })
  writeFileSync(preview, renderReportPage(report, { theme: 'dark', version: '0.1.0', panel: true }), 'utf8')
  process.stdout.write('\nHTML 预览：' + preview + '\n')
}

// Host-half tests: the tool contract, the HTTP route, the persisted state and
// the teardown that makes the plugin unloadable. A stub ctx stands in for the
// harness, so these run without a running DSH.

import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, internals } from '../src/host.js'

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-host-'))
  mkdirSync(join(dir, 'images'), { recursive: true })
  writeFileSync(join(dir, 'images', 'a.png'), 'png', 'utf8')
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({
    activities: [
      { id: 'a', title: 'A', subtitle: '含茶位与甜品', amountFen: 1990, image: 'images/a.png' },
      { id: 'b', title: 'B', subtitle: '含茶位与甜品', amount: 128, image: 'images/a.png' },
    ],
  }, null, 2) + '\n', 'utf8')
  return dir
}

function setup(options) {
  const settings = options || {}
  const tools = []
  const routes = []
  const disposers = []
  const ctx = {
    get(name) {
      if (name === 'fs') return settings.fs
      if (name === 'workingDirectory') return settings.workingDirectory
      return undefined
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return function () {
          const index = tools.indexOf(definition)
          if (index >= 0) tools.splice(index, 1)
        }
      },
    },
    webServer: {
      register(route) {
        if (settings.registerThrows === true) throw new Error('no web server in this host')
        routes.push(route)
        return function () {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(typeof dispose === 'function' ? dispose : function () {})
      return dispose
    },
  }
  apply(ctx, Object.assign({
    dataDir: mkdtempSync(join(tmpdir(), 'catalog-state-')),
  }, settings.config || {}))
  return {
    ctx,
    tools,
    routes,
    tool: tools[0],
    route: routes[0],
    disposeAll() {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        dispose()
      }
    },
  }
}

function request(route, method, url, body) {
  return new Promise(function (resolve, reject) {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value },
      end(payload) { resolve({ status: this.statusCode, headers: this.headers, body: String(payload) }) },
    }
    const req = {
      method: method,
      url: url,
      on(event, handler) {
        if (event === 'data' && body !== undefined) setImmediate(function () { handler(body) })
        if (event === 'end') setImmediate(handler)
        if (event === 'error') { /* nothing to do */ }
      },
    }
    try {
      route.handler(req, res)
    } catch (error) {
      reject(error)
    }
  })
}

// ---- the tool -------------------------------------------------------------

test('the tool is registered with a schema, an output renderer and a card', function () {
  const { tool, disposeAll } = setup()
  try {
    assert.equal(tool.name, 'mp_catalog_guard')
    assert.match(tool.description, /amountFen/)
    assert.equal(tool.parameters.type, 'object')
    assert.deepEqual(Object.keys(tool.parameters.properties).sort(),
      ['apply', 'catalog', 'projectDir', 'render', 'requiredFields'])
    assert.equal(tool.parameters.additionalProperties, false)
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(tool.isConcurrencySafe(), true)
    const card = tool.presentCall({ projectDir: 'x', catalog: 'data.json' })
    assert.equal(card.card, 'generic')
    assert.deepEqual(card.locations, [{ path: 'data.json' }])
  } finally {
    disposeAll()
  }
})

test('the tool checks a project and returns a full report', async function () {
  const project = makeProject()
  const { tool, disposeAll } = setup()
  try {
    const report = await tool.execute({ projectDir: project }, {})
    assert.equal(report.entries, 2)
    assert.equal(report.ok, false)
    assert.ok(report.issues.some(function (issue) { return issue.rule === 'amount-legacy' }))
    assert.equal(report.fixes.count, 1)
    assert.match(report.fixes.diff, /amountFen/)
  } finally {
    disposeAll()
  }
})

test('the tool does not write in dry-run', async function () {
  const project = makeProject()
  const before = readFileSync(join(project, 'catalog.json'), 'utf8')
  const { tool, disposeAll } = setup()
  try {
    await tool.execute({ projectDir: project }, {})
    assert.equal(readFileSync(join(project, 'catalog.json'), 'utf8'), before)
  } finally {
    disposeAll()
  }
})

test('apply:true writes the fix through the tool', async function () {
  const project = makeProject()
  const { tool, disposeAll } = setup()
  try {
    const report = await tool.execute({ projectDir: project, apply: true }, {})
    assert.equal(report.fixes.applied, true)
    const written = JSON.parse(readFileSync(join(project, 'catalog.json'), 'utf8'))
    assert.equal(written.activities[1].amountFen, 12800)
  } finally {
    disposeAll()
  }
})

test('a missing catalog comes back as a report, not as a thrown error', async function () {
  const empty = mkdtempSync(join(tmpdir(), 'catalog-empty-'))
  const { tool, disposeAll } = setup()
  try {
    const report = await tool.execute({ projectDir: empty }, {})
    assert.equal(report.ok, false)
    assert.deepEqual(report.issues.map(function (issue) { return issue.rule }), ['catalog-unreadable'])
  } finally {
    disposeAll()
  }
})

test('the output renderer turns the report into text the model can read', async function () {
  const project = makeProject()
  const { tool, disposeAll } = setup()
  try {
    const report = await tool.execute({ projectDir: project }, {})
    const rendered = tool.output.render({}, report)
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0].type, 'text')
    assert.match(rendered[0].text, /内容目录检查/)
    assert.match(rendered[0].text, /amount-legacy/)
  } finally {
    disposeAll()
  }
})

test('a relative projectDir resolves against the configured base', async function () {
  const base = makeProject()
  const { tool, disposeAll } = setup({ config: { projectDir: base } })
  try {
    const report = await tool.execute({ projectDir: '.' }, {})
    assert.equal(report.entries, 2)
  } finally {
    disposeAll()
  }
})

test('the session working directory wins over the plugin default', async function () {
  const project = makeProject()
  const { tool, disposeAll } = setup({
    workingDirectory: { ensure: async function () { return project } },
  })
  try {
    const report = await tool.execute({}, { agent: { id: 'a1' } })
    assert.equal(report.projectDir.replace(/\\/g, '/').endsWith(project.replace(/\\/g, '/').split('/').pop()), true)
  } finally {
    disposeAll()
  }
})

test('a custom catalog file and imageBase are honoured from config', async function () {
  const project = mkdtempSync(join(tmpdir(), 'catalog-host-cfg-'))
  mkdirSync(join(project, 'static'), { recursive: true })
  writeFileSync(join(project, 'static', 'a.png'), 'png', 'utf8')
  writeFileSync(join(project, 'data.json'), JSON.stringify({
    items: [{ id: 'a', title: 'A', amountFen: 100, image: 'a.png' }],
  }), 'utf8')
  const { tool, disposeAll } = setup({ config: { catalogFile: 'data.json', imageBase: 'static', render: false } })
  try {
    const report = await tool.execute({ projectDir: project }, {})
    assert.equal(report.catalog, 'data.json')
    assert.equal(report.clean, true)
    assert.equal(report.scan.render, false)
  } finally {
    disposeAll()
  }
})

// ---- the route ------------------------------------------------------------

test('GET /state returns the panel HTML and the config', async function () {
  const { route, disposeAll } = setup()
  try {
    const response = await request(route, 'GET', '/dsh-mp-catalog-guard/state')
    assert.equal(response.status, 200)
    assert.match(response.headers['content-type'], /application\/json/)
    const body = JSON.parse(response.body)
    assert.equal(typeof body.panelHtml, 'string')
    assert.match(body.panelHtml, /mc-root/)
    assert.match(body.panelHtml, /还没有检查过/)
    assert.equal(body.config.catalogFile, 'catalog.json')
    assert.equal(body.stats.runs, 0)
  } finally {
    disposeAll()
  }
})

test('the bare route path serves state too', async function () {
  const { route, disposeAll } = setup()
  try {
    const response = await request(route, 'GET', '/dsh-mp-catalog-guard')
    assert.equal(response.status, 200)
    assert.ok(JSON.parse(response.body).panelHtml)
  } finally {
    disposeAll()
  }
})

test('POST /rescan re-runs the check and updates the panel', async function () {
  const project = makeProject()
  const { tool, route, disposeAll } = setup({ config: { projectDir: project } })
  try {
    await tool.execute({ projectDir: project }, {})
    const scanned = await request(route, 'POST', '/dsh-mp-catalog-guard/rescan', '{}')
    assert.equal(scanned.status, 200)
    const body = JSON.parse(scanned.body)
    assert.equal(body.ok, true)
    assert.equal(body.report.entries, 2)
    assert.equal(body.report.mode, 'dry-run')
  } finally {
    disposeAll()
  }
})

test('POST /apply writes the fix and reports it', async function () {
  const project = makeProject()
  const { tool, route, disposeAll } = setup({ config: { projectDir: project } })
  try {
    await tool.execute({ projectDir: project }, {})
    const applied = await request(route, 'POST', '/dsh-mp-catalog-guard/apply', '{}')
    assert.equal(applied.status, 200)
    const body = JSON.parse(applied.body)
    assert.equal(body.ok, true)
    assert.equal(body.report.fixes.applied, true)
    const written = JSON.parse(readFileSync(join(project, 'catalog.json'), 'utf8'))
    assert.equal(written.activities[1].amountFen, 12800)
  } finally {
    disposeAll()
  }
})

test('GET /report.html returns a standalone styled page', async function () {
  const project = makeProject()
  const { tool, route, disposeAll } = setup({ config: { projectDir: project } })
  try {
    await tool.execute({ projectDir: project }, {})
    const response = await request(route, 'GET', '/dsh-mp-catalog-guard/report.html?theme=dark')
    assert.equal(response.status, 200)
    assert.match(response.headers['content-type'], /text\/html/)
    assert.match(response.body, /<!doctype html>/)
    assert.match(response.body, /mc-theme-dark/)
    assert.match(response.body, /amount-legacy/)
    assert.equal(response.body.includes('data-action'), false)
  } finally {
    disposeAll()
  }
})

test('unknown routes and methods are 404s, not 500s', async function () {
  const { route, disposeAll } = setup()
  try {
    assert.equal((await request(route, 'GET', '/dsh-mp-catalog-guard/nope')).status, 404)
    assert.equal((await request(route, 'POST', '/dsh-mp-catalog-guard/nope', '{}')).status, 404)
    assert.equal((await request(route, 'DELETE', '/dsh-mp-catalog-guard/state')).status, 404)
  } finally {
    disposeAll()
  }
})

test('a route handler that hits a broken state answers 500 instead of crashing', async function () {
  const { route, disposeAll } = setup({ config: { projectDir: '\u0000invalid' } })
  try {
    const response = await request(route, 'POST', '/dsh-mp-catalog-guard/rescan', '{}')
    assert.equal([200, 500].includes(response.status), true)
  } finally {
    disposeAll()
  }
})

// ---- lifecycle and persistence -------------------------------------------

test('unload removes the tool and the route', function () {
  const { tools, routes, disposeAll } = setup()
  assert.equal(tools.length, 1)
  assert.equal(routes.length, 1)
  disposeAll()
  assert.equal(tools.length, 0)
  assert.equal(routes.length, 0)
})

test('a host without a web server still gets a working tool', async function () {
  const project = makeProject()
  const { tool, routes, disposeAll } = setup({ registerThrows: true })
  try {
    assert.equal(routes.length, 0)
    const report = await tool.execute({ projectDir: project }, {})
    assert.equal(report.entries, 2)
  } finally {
    disposeAll()
  }
})

test('the latest report and the run stats survive a reload', async function () {
  const project = makeProject()
  const dataDir = mkdtempSync(join(tmpdir(), 'catalog-persist-'))
  const first = setup({ config: { projectDir: project, dataDir: dataDir } })
  await first.tool.execute({ projectDir: project }, {})
  first.disposeAll()
  assert.equal(existsSync(join(dataDir, 'state.json')), true)

  const second = setup({ config: { projectDir: project, dataDir: dataDir } })
  try {
    const response = await request(second.route, 'GET', '/dsh-mp-catalog-guard/state')
    const body = JSON.parse(response.body)
    assert.equal(body.stats.runs, 1)
    assert.equal(body.latest.entries, 2)
    assert.match(body.panelHtml, /mc-root/)
  } finally {
    second.disposeAll()
  }
})

test('a corrupt state file is ignored, not fatal', async function () {
  const dataDir = mkdtempSync(join(tmpdir(), 'catalog-persist-bad-'))
  writeFileSync(join(dataDir, 'state.json'), '{not json', 'utf8')
  const { route, disposeAll } = setup({ config: { dataDir: dataDir } })
  try {
    const response = await request(route, 'GET', '/dsh-mp-catalog-guard/state')
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.body).stats.runs, 0)
  } finally {
    disposeAll()
  }
})

test('history keeps only the last runs and stays lean', async function () {
  const project = makeProject()
  const dataDir = mkdtempSync(join(tmpdir(), 'catalog-history-'))
  const { tool, route, disposeAll } = setup({ config: { projectDir: project, dataDir: dataDir } })
  try {
    for (let i = 0; i < 23; i++) await tool.execute({ projectDir: project }, {})
    const response = await request(route, 'GET', '/dsh-mp-catalog-guard/state')
    const body = JSON.parse(response.body)
    assert.equal(body.history.length, 12)
    assert.equal(body.history[0].entries, 2)
    assert.equal(body.history[0].issues, undefined)
    assert.equal(body.stats.runs, 23)
    const saved = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'))
    assert.equal(saved.history.length, 20)
  } finally {
    disposeAll()
  }
})

// ---- small helpers --------------------------------------------------------

test('segmentsOf only accepts paths under the plugin route', function () {
  assert.deepEqual(internals.segmentsOf('/dsh-mp-catalog-guard'), [])
  assert.deepEqual(internals.segmentsOf('/dsh-mp-catalog-guard/'), [])
  assert.deepEqual(internals.segmentsOf('/dsh-mp-catalog-guard/state?x=1'), ['state'])
  assert.deepEqual(internals.segmentsOf('/dsh-mp-catalog-guard/a/b'), ['a', 'b'])
  assert.deepEqual(internals.segmentsOf('/other/state'), [])
  assert.deepEqual(internals.segmentsOf(undefined), [])
})

test('themeOf reads only a known theme value', function () {
  assert.equal(internals.themeOf('/x?theme=dark'), 'dark')
  assert.equal(internals.themeOf('/x?a=1&theme=light'), 'light')
  assert.equal(internals.themeOf('/x?theme=neon'), 'auto')
  assert.equal(internals.themeOf('/x'), 'auto')
})

test('leanReport caps a huge diff and a long file list', function () {
  const big = {
    fixes: { diff: 'x'.repeat(300_000), count: 1 },
    render: { files: new Array(30).fill('a.wxml') },
  }
  const lean = internals.leanReport(big)
  assert.equal(lean.fixes.truncated, true)
  assert.ok(lean.fixes.diff.length < 300_000)
  assert.equal(lean.render.files.length, 20)
  assert.equal(internals.leanReport(undefined), undefined)
})

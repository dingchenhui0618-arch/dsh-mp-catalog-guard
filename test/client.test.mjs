// Client-half tests. React and the DOM are stubbed; what is asserted is the
// contract the harness relies on: module shape, the slot registration, the
// stylesheet lifecycle, and that the two buttons reach the host.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PAGE_CSS } from '../src/panel-html.js'

const require = createRequire(import.meta.url)
const CLIENT = require.resolve('../src/client.cjs')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

function load() {
  const appended = []
  const created = []
  const style = {
    dataset: {},
    textContent: '',
    removed: false,
    remove() { this.removed = true },
  }
  globalThis.document = {
    head: { appendChild(element) { appended.push(element) } },
    createElement() { created.push(style); return style },
  }
  const calls = []
  globalThis.fetch = function (url, init) {
    calls.push({ url: url, method: (init && init.method) || 'GET' })
    return Promise.resolve({ json: function () { return Promise.resolve({ panelHtml: '<div class="mc-root">panel</div>' }) } })
  }

  const effects = []
  const cleanups = []
  const React = {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2)
      return { type: type, props: props || {}, children: children }
    },
    useState(initial) { return [initial, function () {}] },
    useEffect(fn) {
      effects.push(fn)
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'react') return React
    return originalLoad.call(this, request, parent, isMain)
  }
  let client
  try {
    delete require.cache[CLIENT]
    client = require(CLIENT)
  } finally {
    Module._load = originalLoad
  }

  const registered = []
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    slots: {
      inject(name, factory) {
        assert.equal(name, 'conversation.view')
        factory()
      },
      register(target, component) {
        registered.push({ target: target, component: component })
        return function () {
          const index = registered.indexOf(registered[registered.length - 1])
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
  client.apply(ctx)

  return {
    client: client,
    ctx: ctx,
    style: style,
    created: created,
    appended: appended,
    calls: calls,
    effects: effects,
    cleanups: cleanups,
    registered: registered,
    disposers: disposers,
    tick() { return new Promise(function (resolve) { setTimeout(resolve, 5) }) },
    disposeAll() {
      while (cleanups.length > 0) cleanups.pop()()
      while (disposers.length > 0) disposers.pop()()
    },
  }
}

function clickEvent(button, rootNode) {
  return { target: button, currentTarget: rootNode }
}

// ---- module shape ---------------------------------------------------------

test('the client module is the shape the harness loads', function () {
  const harness = load()
  try {
    assert.equal(harness.client.name, 'dsh-mp-catalog-guard')
    assert.deepEqual(harness.client.inject, ['slots'])
    assert.equal(typeof harness.client.apply, 'function')
  } finally {
    harness.disposeAll()
  }
})

test('the stylesheet is injected once and removed on unload', function () {
  const harness = load()
  assert.equal(harness.created.length, 1)
  assert.equal(harness.appended.length, 1)
  assert.equal(harness.style.dataset.plugin, 'dsh-mp-catalog-guard')
  assert.match(harness.style.textContent, /\.mc-root/)
  harness.disposeAll()
  assert.equal(harness.style.removed, true)
})

// ---- slot -----------------------------------------------------------------

test('the panel registers into conversation.view with a stable id and order', function () {
  const harness = load()
  try {
    assert.equal(harness.registered.length, 1)
    const { target, component } = harness.registered[0]
    assert.equal(target.name, 'conversation.view')
    assert.equal(target.id, 'mp-catalog-guard')
    assert.equal(target.order, 32)
    assert.equal(target.label, '内容目录')
    assert.equal(typeof component, 'function')
  } finally {
    harness.disposeAll()
  }
})

// ---- rendering and polling ------------------------------------------------

test('the panel reads /state once and renders the host HTML verbatim', async function () {
  const harness = load()
  try {
    const tree = harness.registered[0].component({})
    assert.deepEqual(harness.calls[0], { url: '/dsh-mp-catalog-guard/state', method: 'GET' })
    await harness.tick()
    const fresh = harness.registered[0].component({})
    assert.equal(fresh.type, 'div')
    assert.equal(fresh.props.className, 'mc-root-wrap')
    assert.equal(typeof fresh.props.onClick, 'function')
    const host = fresh.children[1]
    assert.equal(host.props.className, 'mc-host')
    assert.match(host.props.dangerouslySetInnerHTML.__html, /mc-root/)
  } finally {
    harness.disposeAll()
  }
})

test('a fetch failure is shown as a banner and keeps the last HTML', async function () {
  const harness = load()
  globalThis.fetch = function () { return Promise.reject(new Error('boom')) }
  try {
    harness.registered[0].component({})
    await harness.tick()
    const tree = harness.registered[0].component({})
    assert.match(tree.children[0].props.className, /mc-panel-error/)
  } finally {
    harness.disposeAll()
  }
})

test('the rescan button posts to the host and refreshes', async function () {
  const harness = load()
  try {
    const tree = harness.registered[0].component({})
    const root = {}
    const button = { getAttribute: (name) => (name === 'data-action' ? 'rescan' : null), disabled: false, parentNode: root }
    tree.props.onClick(clickEvent(button, root))
    await harness.tick()
    const posted = harness.calls.filter(function (call) { return call.method === 'POST' })
    assert.deepEqual(posted.map(function (call) { return call.url }), ['/dsh-mp-catalog-guard/rescan'])
    // the POST is followed by a fresh GET so the panel shows the new result
    assert.equal(harness.calls[harness.calls.length - 1].method, 'GET')
  } finally {
    harness.disposeAll()
  }
})

test('the apply button posts apply', async function () {
  const harness = load()
  try {
    const tree = harness.registered[0].component({})
    const root = {}
    const button = { getAttribute: (name) => (name === 'data-action' ? 'apply' : null), disabled: false, parentNode: root }
    tree.props.onClick(clickEvent(button, root))
    await harness.tick()
    const posted = harness.calls.filter(function (call) { return call.method === 'POST' })
    assert.deepEqual(posted.map(function (call) { return call.url }), ['/dsh-mp-catalog-guard/apply'])
  } finally {
    harness.disposeAll()
  }
})

test('a disabled button posts nothing', async function () {
  const harness = load()
  try {
    const tree = harness.registered[0].component({})
    const root = {}
    const button = {
      getAttribute: (name) => (name === 'data-action' ? 'apply' : (name === 'disabled' ? '' : null)),
      disabled: true,
      parentNode: root,
    }
    tree.props.onClick(clickEvent(button, root))
    await harness.tick()
    assert.equal(harness.calls.filter(function (call) { return call.method === 'POST' }).length, 0)
  } finally {
    harness.disposeAll()
  }
})

test('a click on a child of the button still finds the action', async function () {
  const harness = load()
  try {
    const tree = harness.registered[0].component({})
    const root = {}
    const button = { getAttribute: (name) => (name === 'data-action' ? 'rescan' : null), disabled: false, parentNode: root }
    const span = { getAttribute: () => null, parentNode: button }
    const label = { getAttribute: () => null, parentNode: span }
    tree.props.onClick(clickEvent(label, root))
    await harness.tick()
    assert.equal(harness.calls.filter(function (call) { return call.method === 'POST' }).length, 1)
  } finally {
    harness.disposeAll()
  }
})

test('a click outside any button does nothing', async function () {
  const harness = load()
  try {
    const tree = harness.registered[0].component({})
    const root = {}
    const plain = { getAttribute: () => null, parentNode: root }
    tree.props.onClick(clickEvent(plain, root))
    await harness.tick()
    assert.equal(harness.calls.filter(function (call) { return call.method === 'POST' }).length, 0)
  } finally {
    harness.disposeAll()
  }
})

test('a second mount does not start a second poller', function () {
  const harness = load()
  try {
    harness.registered[0].component({})
    harness.registered[0].component({})
    assert.equal(harness.calls.filter(function (call) { return call.url === '/dsh-mp-catalog-guard/state' }).length, 1)
  } finally {
    harness.disposeAll()
  }
})

// ---- stylesheet -----------------------------------------------------------

test('every class the panel emits has a rule behind it', function () {
  const htmlSource = readFileSync(join(ROOT, 'src', 'panel-html.js'), 'utf8')
  const clientCss = require('../src/client-css.cjs')
  const css = clientCss + PAGE_CSS
  const missing = []
  for (const match of htmlSource.matchAll(/mc-[a-z0-9-]+/g)) {
    const token = match[0]
    if (token.endsWith('-')) continue
    // --mc-radius is a custom property, not a class
    if (htmlSource.slice(Math.max(0, match.index - 2), match.index) === '--') continue
    if (css.indexOf('.' + token) === -1) missing.push(token)
  }
  assert.deepEqual(missing, [])
})

test('colour literals only appear as theme-token fallbacks', function () {
  const css = require('../src/client-css.cjs')
  const literals = css.match(/#[0-9a-fA-F]{3,8}/g) || []
  assert.ok(literals.length > 0)
  // every literal must sit in the default slot of a var(...) call
  const fallbacks = css.match(/var\(--dsw-alias-[a-z-]+,#[0-9a-fA-F]{3,8}\)/g) || []
  assert.equal(literals.length, fallbacks.length)
  assert.match(css, /--dsw-alias-label-secondary/)
})

test('the stylesheet includes a narrow layout', function () {
  const css = require('../src/client-css.cjs')
  assert.match(css, /@media \(max-width:720px\)/)
})

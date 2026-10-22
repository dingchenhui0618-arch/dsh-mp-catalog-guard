// Client half of dsh-mp-catalog-guard: the 内容目录 Tab.
//
// The panel renders host-produced HTML rather than rebuilding the report in
// React. One markup implementation (src/panel-html.js) serves the panel, the
// standalone report page and the screenshot in docs/, so what the screenshot
// shows cannot drift away from what the panel shows. This half only owns the
// shell, the polling, and the two buttons.
//
// Must stay CommonJS — the build wraps this in window.__ModuleLoader__.load()
// and React is supplied by the harness.

const React = require('react')
const h = React.createElement
const CSS = require('./client-css.cjs')

const API = '/dsh-mp-catalog-guard'
const POLL_MS = 2500

// One poller shared by every mounted view; the host is the single source of
// truth, this side only mirrors /state.
let snap = { html: '', error: '', at: 0 }
const listeners = new Set()
let timer = null

function emit() {
  Array.from(listeners).forEach(function (fn) {
    try {
      fn(snap)
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-mp-catalog-guard] listener failed', error)
    }
  })
}

function load() {
  fetch(API + '/state', { headers: { accept: 'application/json' } })
    .then(function (res) { return res.json() })
    .then(function (data) {
      snap = { html: typeof data.panelHtml === 'string' ? data.panelHtml : '', error: '', at: Date.now() }
      emit()
    })
    .catch(function (error) {
      snap = { html: snap.html, error: String((error && error.message) || error), at: Date.now() }
      emit()
    })
}

function post(action) {
  return fetch(API + '/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then(function (res) { return res.json() })
    .then(function () { load() })
    .catch(function () {})
}

function subscribe(fn) {
  listeners.add(fn)
  if (timer === null) {
    load()
    timer = setInterval(load, POLL_MS)
  }
  fn(snap)
  return function () {
    listeners.delete(fn)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

// The buttons live inside host HTML, so the click is resolved by walking up to
// the nearest [data-action] holder instead of binding a handler per button.
function handleClick(event) {
  let node = event.target
  while (node !== null && node !== undefined && node !== event.currentTarget) {
    if (typeof node.getAttribute === 'function') {
      const action = node.getAttribute('data-action')
      if (action) {
        const disabled = node.disabled === true || node.getAttribute('disabled') !== null
        if (!disabled) post(action)
        return
      }
    }
    node = node.parentNode
  }
}

function Panel() {
  const [state, setState] = React.useState(snap)
  React.useEffect(function () { return subscribe(setState) }, [])
  return h('div', { className: 'mc-root-wrap', onClick: handleClick },
    state.error ? h('div', { className: 'mc-panel-error' }, '与 host 通信失败：' + state.error) : null,
    state.html
      ? h('div', { className: 'mc-host', dangerouslySetInnerHTML: { __html: state.html } })
      : h('div', { className: 'mc-loading' }, '正在读取检查结果…'),
  )
}

function apply(ctx) {
  // Every registration has a teardown: the shared poller lives at module scope
  // and therefore outlives one apply().
  ctx.effect(function () {
    return function () {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      listeners.clear()
      snap = { html: '', error: '', at: 0 }
    }
  })

  ctx.effect(function () {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-mp-catalog-guard'
    style.textContent = CSS
    document.head.appendChild(style)
    return function () { style.remove() }
  })

  // Guarded and normalised to a disposer: a changed slot contract must cost this
  // one panel, not the client boot of every other plugin.
  ctx.slots.inject('conversation.view', function () {
    let disposeView
    try {
      disposeView = ctx.slots.register(
        { name: 'conversation.view', id: 'mp-catalog-guard', order: 32, label: '内容目录' },
        Panel,
      )
    } catch (error) {
      disposeView = undefined
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[dsh-mp-catalog-guard] could not register the 内容目录 view', error)
      }
    }
    return typeof disposeView === 'function' ? disposeView : function () {}
  })
}

module.exports = {
  name: 'dsh-mp-catalog-guard',
  inject: ['slots'],
  apply: apply,
}

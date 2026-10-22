/* dsh-mp-catalog-guard client bundle — generated from src/client.cjs */
window.__ModuleLoader__.load({
  id: "dsh-mp-catalog-guard",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
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
const CSS = ".mc-root{display:flex;flex-direction:column;gap:16px;padding:18px 20px 20px;height:100%;overflow:auto;color:inherit;font-size:13px;line-height:1.55;box-sizing:border-box}.mc-host .mc-root{height:auto;padding:0}.mc-root-wrap{height:100%;overflow:auto;box-sizing:border-box}.mc-loading{padding:20px;opacity:.5;font-size:12px}.mc-panel-error{margin:0 0 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 8%,transparent);border-radius:8px;padding:7px 10px;font-size:12px}.mc-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 16px;align-items:start}.mc-head-text{min-width:0}.mc-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mc-title{font-size:16px;font-weight:600;letter-spacing:.01em}.mc-sub{font-size:12px;opacity:.55;margin-top:3px}.mc-verdict{font-size:11px;line-height:1.65;padding:0 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}.mc-verdict.mc-ok{color:var(--dsw-alias-state-success-primary,#1a7f37);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 10%,transparent)}.mc-verdict.mc-warn{color:var(--dsw-alias-state-warn-primary,#a15c00);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#a15c00) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#a15c00) 10%,transparent)}.mc-verdict.mc-bad{color:var(--dsw-alias-state-error-primary,#c92a2a);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 10%,transparent)}.mc-verdict.mc-idle{opacity:.55;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28))}.mc-head-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px;min-width:0;max-width:340px}.mc-head-meta{display:flex;align-items:center;gap:8px;white-space:nowrap}.mc-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;padding:2px 7px;border-radius:6px;background:color-mix(in srgb,currentColor 6%,transparent);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mc-mode{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;opacity:.7;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:999px;padding:0 7px}.mc-time{font-size:11px;opacity:.5;font-variant-numeric:tabular-nums;white-space:nowrap}.mc-actions{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;align-items:center}.mc-btn{font:inherit;font-size:12px;padding:4px 11px;border-radius:7px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:transparent;color:inherit;transition:background .12s ease,border-color .12s ease}.mc-btn:hover{background:color-mix(in srgb,currentColor 7%,transparent)}.mc-btn:disabled{opacity:.4;cursor:default;background:transparent}.mc-btn-primary{color:var(--dsw-alias-brand-primary,#3b5bdb);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b5bdb) 45%,transparent)}.mc-btn-primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b5bdb) 12%,transparent)}.mc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:9px}.mc-stat{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;padding:9px 11px;background:var(--dsw-alias-bg-layer-1,transparent)}.mc-stat b{display:block;font-size:20px;font-weight:600;line-height:1.15;font-variant-numeric:tabular-nums}.mc-stat span{font-size:11px;opacity:.55}.mc-stat.mc-bad b{color:var(--dsw-alias-state-error-primary,#c92a2a)}.mc-stat.mc-warn b{color:var(--dsw-alias-state-warn-primary,#a15c00)}.mc-stat.mc-good b{color:var(--dsw-alias-state-success-primary,#1a7f37)}.mc-section{display:flex;flex-direction:column;gap:8px}.mc-section-head{display:flex;align-items:baseline;gap:8px;font-size:12px;font-weight:600;letter-spacing:.01em}.mc-count{font-weight:400;font-size:11.5px;opacity:.55;font-variant-numeric:tabular-nums}.mc-list{display:flex;flex-direction:column;gap:7px}.mc-issue{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-left:3px solid transparent;border-radius:9px;padding:8px 11px;background:var(--dsw-alias-bg-layer-1,transparent)}.mc-issue.mc-sev-error{border-left-color:var(--dsw-alias-state-error-primary,#c92a2a)}.mc-issue.mc-sev-warn{border-left-color:var(--dsw-alias-state-warn-primary,#a15c00)}.mc-issue.mc-sev-info{border-left-color:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}.mc-issue-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mc-rule{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;padding:1px 6px;border-radius:5px;background:color-mix(in srgb,currentColor 7%,transparent);opacity:.9}.mc-loc{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.55}.mc-tag{font-size:10.5px;padding:0 6px;border-radius:999px;border:1px solid transparent;white-space:nowrap}.mc-tag-fix{color:var(--dsw-alias-state-success-primary,#1a7f37);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 8%,transparent)}.mc-tag-manual{opacity:.5;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.28))}.mc-eid{font-size:11px;opacity:.45;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.mc-msg{font-size:12.5px;margin-top:5px}.mc-hint{font-size:11.5px;opacity:.6;margin-top:3px}.mc-snippet{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;opacity:.6;margin-top:5px;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));white-space:pre-wrap;word-break:break-word}.mc-clean{display:flex;gap:10px;align-items:flex-start;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 7%,transparent);border-radius:10px;padding:12px 14px;color:var(--dsw-alias-state-success-primary,#1a7f37)}.mc-clean b{display:block;font-size:13px}.mc-clean span{display:block;font-size:11.5px;opacity:.85;margin-top:2px;color:var(--dsw-alias-label-secondary,inherit)}.mc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:44px 16px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:12px;opacity:.85}.mc-empty svg{opacity:.4}.mc-empty-title{font-size:13px;font-weight:600;margin-top:2px}.mc-empty-sub{font-size:11.5px;opacity:.6;max-width:340px}.mc-diff{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,transparent)}.mc-diff-file{display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}.mc-dim{opacity:.5;font-size:11px}.mc-diff-body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.7;max-height:360px;overflow:auto;padding:6px 0}.mc-root.mc-static .mc-diff-body{max-height:none}.mc-dl{padding:0 12px;white-space:pre;min-height:1.7em}.mc-dl.mc-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 12%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 78%,currentColor)}.mc-dl.mc-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 12%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 78%,currentColor)}.mc-dl.mc-hh{color:var(--dsw-alias-brand-primary,#3b5bdb);opacity:.85}.mc-dl.mc-dh{opacity:.45}.mc-dl.mc-ctx{opacity:.85}.mc-scan{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;opacity:.55}.mc-sep{opacity:.5}.mc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.mc-notes{display:flex;flex-direction:column;gap:3px;font-size:11.5px;opacity:.6}.mc-note{border-left:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));padding-left:8px}.mc-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c92a2a) 8%,transparent);border-radius:8px;padding:8px 10px;font-size:12px}@media (max-width:720px){.mc-head{grid-template-columns:1fr}.mc-head-side{max-width:100%;align-items:flex-start}.mc-actions{justify-content:flex-start}}"

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
    return module.exports;
  },
});

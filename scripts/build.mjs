#!/usr/bin/env node
// Dependency-free build.
//
// The host half is plain ESM whose only imports are node: builtins and its own
// sibling modules, so copying the sources into lib/ is a complete build — no
// bundler, and therefore no devDependency that can fail to install.
//
// The client half is CommonJS loaded through window.__ModuleLoader__ with a
// harness-provided require(), so it must carry no relative require of its own.
// Its one relative require (the stylesheet) is inlined below; the host keeps a
// real copy of the same file because it renders the standalone report page.

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { wrapClient } from './wrap-client.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'lib')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// host.js becomes index.js; its sibling imports keep their names.
const HOST_MODULES = [
  'rules.js',
  'catalog.js',
  'assets.js',
  'render.js',
  'fix.js',
  'report.js',
  'check.js',
  'io.js',
  'panel-html.js',
  'cli.js',
]
await copyFile(join(root, 'src', 'host.js'), join(out, 'index.js'))
for (const file of HOST_MODULES) {
  await copyFile(join(root, 'src', file), join(out, file))
}
// index.js imports the stylesheet directly to render the report page.
await copyFile(join(root, 'src', 'client-css.cjs'), join(out, 'client-css.cjs'))

const cssModule = await import(pathToFileURL(join(root, 'src', 'client-css.cjs')).href)
const css = cssModule.default
if (typeof css !== 'string' || css.length === 0) {
  throw new Error('src/client-css.cjs did not export a non-empty CSS string')
}
if (!css.includes('.mc-root') || !css.includes('.mc-diff-body')) {
  throw new Error('src/client-css.cjs lost the panel rules — the report page would render unstyled')
}

const clientSource = await readFile(join(root, 'src', 'client.cjs'), 'utf8')
const CSS_REQUIRE = /require\((['"])\.\/client-css\.cjs\1\)/
if (!CSS_REQUIRE.test(clientSource)) {
  throw new Error('src/client.cjs no longer requires ./client-css.cjs — update scripts/build.mjs')
}

const bundle = wrapClient(clientSource.replace(CSS_REQUIRE, JSON.stringify(css)), pkg.name)
await writeFile(join(out, 'client.js'), bundle)

// Compile the client bundle and import every host module: a broken build fails
// here rather than in the browser or on the first tool call.
new Function(bundle)
const host = await import(pathToFileURL(join(out, 'index.js')).href)
if (host.name !== pkg.name || typeof host.apply !== 'function') {
  throw new Error('invalid host plugin export: expected name "' + pkg.name + '" and an apply() function')
}
for (const file of HOST_MODULES) {
  await import(pathToFileURL(join(out, file)).href)
}

console.log('Built ' + pkg.name + ' ' + pkg.version + ': lib/index.js, lib/client.js and ' + HOST_MODULES.length + ' host modules')

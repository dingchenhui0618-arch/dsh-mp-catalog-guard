#!/usr/bin/env node
// The published executable. Runs the built host modules, exactly like the plugin
// does, from a terminal or a CI step.
//
// Exit codes: 0 clean, 1 issues found, 2 bad usage. See src/cli.js for the flags.

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { main } from '../lib/cli.js'

function version() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch (error) {
    return undefined
  }
}

main(process.argv.slice(2), { version: version() })
  .then(function (code) { process.exitCode = code })
  .catch(function (error) {
    process.stderr.write('mp-catalog-guard 崩溃：' + String((error && error.stack) || error) + '\n')
    process.exitCode = 2
  })

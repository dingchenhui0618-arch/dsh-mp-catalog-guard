// node:fs implementation of the tiny IO surface the checker needs.
//
// `checkProject` is written against this interface instead of importing fs, so
// the host can hand it the harness's own filesystem service and the tests can
// hand it an in-memory map.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { collectSourceFiles } from './render.js'

export function nodeIo() {
  return {
    /** @param {string} path @returns {Promise<string>} */
    readText(path) {
      return new Promise(function (resolve, reject) {
        try {
          resolve(readFileSync(path, 'utf8'))
        } catch (error) {
          reject(error)
        }
      })
    },
    /** @param {string} path @param {string} text @returns {Promise<void>} */
    writeText(path, text) {
      return new Promise(function (resolve, reject) {
        try {
          writeFileSync(path, text, 'utf8')
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    },
    /** @param {string} path @returns {boolean} */
    exists(path) {
      try {
        return existsSync(path)
      } catch (error) {
        return false
      }
    },
    /** @param {string} root @param {string[]} patterns */
    listFiles(root, patterns) {
      return Promise.resolve(collectSourceFiles(root, patterns))
    },
    now() {
      return new Date()
    },
  }
}

/** In-memory IO for tests: `files` maps absolute paths to text. */
export function memoryIo(files, options) {
  const settings = options || {}
  const store = new Map(Object.entries(files || {}))
  const writes = []
  return {
    writes: writes,
    store: store,
    readText(path) {
      if (!store.has(path)) {
        const error = new Error('ENOENT: no such file or directory: ' + path)
        error.code = 'ENOENT'
        return Promise.reject(error)
      }
      return Promise.resolve(store.get(path))
    },
    writeText(path, text) {
      store.set(path, text)
      writes.push({ path: path, text: text })
      return Promise.resolve()
    },
    exists(path) {
      if (store.has(path)) return true
      if (typeof settings.exists === 'function') return settings.exists(path)
      return false
    },
    listFiles() {
      return Promise.resolve(Array.isArray(settings.sourceFiles) ? settings.sourceFiles : [])
    },
    now() {
      return new Date('2026-10-22T00:00:00.000Z')
    },
  }
}

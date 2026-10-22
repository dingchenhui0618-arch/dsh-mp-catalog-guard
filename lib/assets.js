// Image path checks.
//
// Whether a file exists is injected (`options.exists`) so the check is a pure
// function under test; the host and the CLI pass the real filesystem in. Paths
// are always relative to the project root and always reported with forward
// slashes, so a report written on Windows stays readable in a terminal that is
// not Windows.

import { isPlainObject } from './catalog.js'
import { makeIssue } from './rules.js'

/** `https://…`, `cloud://…`, `wxfile://…` — anything with a scheme. */
export function isRemotePath(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

export function isAbsoluteImagePath(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

/** `images/a.png` + `images` → `images/images/a.png` is wrong; join only when needed. */
export function joinRelative(base, value) {
  const left = String(base || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const right = String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (left.length === 0) return right
  if (right === left || right.startsWith(left + '/')) return right
  return left + '/' + right
}

/**
 * @param {any[]} activities
 * @param {{exists: (relPath: string) => boolean, file?: string, imageBase?: string,
 *          entryLines?: Array<number|undefined>}} options
 */
export function checkImages(activities, options) {
  const settings = options || {}
  const exists = typeof settings.exists === 'function' ? settings.exists : function () { return true }
  const file = typeof settings.file === 'string' ? settings.file : 'catalog.json'
  const imageBase = typeof settings.imageBase === 'string' ? settings.imageBase : ''
  const lines = Array.isArray(settings.entryLines) ? settings.entryLines : []
  const issues = []

  activities.forEach(function (entry, index) {
    if (!isPlainObject(entry)) return
    const base = {
      file: file,
      line: lines[index],
      entry: index,
      entryId: typeof entry.id === 'string' ? entry.id : undefined,
    }
    const value = entry.image
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push(makeIssue('image-missing', Object.assign({}, base, {
        field: 'image',
        message: '没有 image 字段，列表里会缺图。',
      })))
      return
    }
    const image = value.trim()
    if (isRemotePath(image)) {
      issues.push(makeIssue('image-remote', Object.assign({}, base, {
        field: 'image',
        message: 'image 是远程地址，离线校验不了它是否还能访问：' + image,
      })))
      return
    }
    if (image.indexOf('..') >= 0) {
      issues.push(makeIssue('image-outside', Object.assign({}, base, {
        field: 'image',
        message: 'image 路径用 .. 跳出了项目目录：' + image,
      })))
    }
    if (isAbsoluteImagePath(image)) {
      const stripped = image.replace(/^\/+/, '').replace(/\\/g, '/')
      const candidate = joinRelative(imageBase, stripped)
      if (exists(candidate)) {
        issues.push(makeIssue('image-absolute', Object.assign({}, base, {
          field: 'image',
          fixable: true,
          message: 'image 用了绝对路径 "' + image + '"，小程序只认相对路径；应为 "' + candidate + '"。',
        })))
      } else {
        issues.push(makeIssue('image-missing', Object.assign({}, base, {
          field: 'image',
          hint: '去掉开头的 / 之后也找不到这个文件。',
          message: '图片不存在：' + image,
        })))
      }
      return
    }
    const candidate = joinRelative(imageBase, image)
    if (!exists(candidate)) {
      issues.push(makeIssue('image-missing', Object.assign({}, base, {
        field: 'image',
        message: '图片不存在：' + candidate,
      })))
    }
  })

  return issues
}

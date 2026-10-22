// Image path tests. Existence is injected, so these run without a fixture tree.

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { checkImages, isAbsoluteImagePath, isRemotePath, joinRelative } from '../src/assets.js'

function check(activities, existing, options) {
  const files = new Set(existing)
  return checkImages(activities, Object.assign({
    exists: function (rel) { return files.has(rel) },
  }, options || {}))
}

function ids(issues) {
  return issues.map(function (issue) { return issue.rule })
}

test('an existing relative image passes', function () {
  const issues = check([{ id: 'a', image: 'images/a.png' }], ['images/a.png'])
  assert.deepEqual(ids(issues), [])
})

test('a missing image is an error that names the resolved path', function () {
  const issues = check([{ id: 'a', image: 'images/nope.png' }], [])
  assert.deepEqual(ids(issues), ['image-missing'])
  assert.match(issues[0].message, /images\/nope\.png/)
  assert.equal(issues[0].field, 'image')
})

test('a remote image is info, because offline cannot verify it', function () {
  const issues = check([{ id: 'a', image: 'https://cdn.example.com/a.png' }], [])
  assert.deepEqual(ids(issues), ['image-remote'])
  assert.equal(issues[0].severity, 'info')
})

test('an absolute path whose relative form exists is fixable', function () {
  const issues = check([{ id: 'a', image: '/images/a.png' }], ['images/a.png'])
  assert.deepEqual(ids(issues), ['image-absolute'])
  assert.equal(issues[0].fixable, true)
  assert.match(issues[0].message, /images\/a\.png/)
})

test('an absolute path with no relative form is just missing', function () {
  const issues = check([{ id: 'a', image: '/images/a.png' }], [])
  assert.deepEqual(ids(issues), ['image-missing'])
  assert.equal(issues[0].fixable, false)
})

test('a Windows drive letter counts as absolute', function () {
  assert.equal(isAbsoluteImagePath('D:\\assets\\a.png'), true)
  assert.equal(isAbsoluteImagePath('images/a.png'), false)
  const issues = check([{ id: 'a', image: 'D:/assets/a.png' }], [])
  assert.deepEqual(ids(issues), ['image-missing'])
})

test('.. in an image path is a warning even when the file exists', function () {
  const issues = check([{ id: 'a', image: '../shared/a.png' }], ['../shared/a.png'])
  assert.deepEqual(ids(issues), ['image-outside'])
  assert.equal(issues[0].severity, 'warn')
})

test('imageBase prefixes the path once', function () {
  const issues = check([{ id: 'a', image: 'a.png' }], ['static/a.png'], { imageBase: 'static' })
  assert.deepEqual(ids(issues), [])
})

test('a path that already starts with imageBase is not prefixed twice', function () {
  assert.equal(joinRelative('static', 'static/a.png'), 'static/a.png')
  assert.equal(joinRelative('', '/a.png'), 'a.png')
  assert.equal(joinRelative('static', 'a.png'), 'static/a.png')
})

test('a missing or non-string image is reported as missing', function () {
  const issues = check([
    { id: 'a' },
    { id: 'b', image: '   ' },
    { id: 'c', image: 42 },
  ], [])
  assert.equal(ids(issues).filter(function (id) { return id === 'image-missing' }).length, 3)
})

test('scheme detection does not mistake a relative path for a URL', function () {
  assert.equal(isRemotePath('cloud://env-1/a.png'), true)
  assert.equal(isRemotePath('wxfile://tmp/a.png'), true)
  assert.equal(isRemotePath('images/a.png'), false)
})

test('entry lines flow through to the issue location', function () {
  const issues = checkImages([{ id: 'a', image: 'x.png' }], {
    exists: function () { return false },
    file: 'catalog.json',
    entryLines: [12],
  })
  assert.equal(issues[0].line, 12)
  assert.equal(issues[0].file, 'catalog.json')
})

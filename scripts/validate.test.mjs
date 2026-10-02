import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePackage } from './validate.mjs'

const FILE = 'packages/@pikku/example.yaml'
const ok = (overrides = {}) => ({
  package: '@pikku/example',
  entries: [
    { versions: '*', cloud: { edge: ['cloudflare-workers'], serverless: true } },
  ],
  ...overrides,
})
const problems = (doc, file = FILE) => validatePackage(doc, file)
const has = (list, text) => list.some((p) => p.includes(text))

test('a plain edge entry is valid', () => {
  assert.deepEqual(problems(ok()), [])
})

test('a server-only entry needs a reason, and passes with one', () => {
  const entry = { versions: '*', cloud: { edge: false, serverless: false } }
  assert.ok(has(problems(ok({ entries: [entry] })), 'needs a "reason"'))
  assert.deepEqual(problems(ok({ entries: [{ ...entry, reason: 'reads the disk' }] })), [])
})

test('the file path must match the package name', () => {
  assert.ok(has(problems(ok(), 'packages/@pikku/other.yaml'), 'must be packages/@pikku/example.yaml'))
})

test('overlapping version ranges are refused', () => {
  const cloud = { edge: false, serverless: true }
  const doc = ok({
    entries: [
      { versions: '>=1', cloud, reason: 'a' },
      { versions: '>=2', cloud, reason: 'b' },
    ],
  })
  assert.ok(has(problems(doc), 'overlap'))
})

test('disjoint version ranges are accepted', () => {
  const cloud = { edge: false, serverless: true }
  const doc = ok({
    entries: [
      { versions: '<2', cloud, reason: 'a' },
      { versions: '>=2', cloud: { edge: ['cloudflare-workers'], serverless: true } },
    ],
  })
  assert.deepEqual(problems(doc), [])
})

test('edge support without serverless support is a contradiction', () => {
  const doc = ok({ entries: [{ versions: '*', cloud: { edge: ['cloudflare-workers'], serverless: false }, reason: 'x' }] })
  assert.ok(has(problems(doc), 'implies serverless'))
})

test('unknown platforms, runtimes, keys and bad ranges are refused', () => {
  const doc = ok({
    entries: [
      {
        versions: 'not a range',
        cloud: { edge: ['mars-edge'], serverless: true },
        runtime: ['node', 'cobol'],
        surprise: 1,
      },
    ],
  })
  const list = problems(doc)
  assert.ok(has(list, 'not a valid semver range'))
  assert.ok(has(list, 'unknown platform "mars-edge"'))
  assert.ok(has(list, 'unknown runtime "cobol"'))
  assert.ok(has(list, 'unknown key "surprise"'))
})

test('a subpath override that narrows needs the reason too', () => {
  const doc = ok({
    entries: [
      {
        versions: '*',
        cloud: { edge: ['cloudflare-workers'], serverless: true },
        exports: { './dev': { cloud: { edge: false, serverless: false } } },
      },
    ],
  })
  assert.ok(has(problems(doc), 'needs a "reason"'))
})

test('subpath keys must start with ./', () => {
  const doc = ok({
    entries: [
      {
        versions: '*',
        cloud: { edge: false, serverless: true },
        reason: 'x',
        exports: { dev: { cloud: { edge: false, serverless: true } } },
      },
    ],
  })
  assert.ok(has(problems(doc), 'must be "." or start with "./"'))
})

test('an empty entries list and a non-mapping file are refused', () => {
  assert.ok(has(problems(ok({ entries: [] })), 'non-empty list'))
  assert.ok(has(problems('nope'), 'must be a YAML mapping'))
})

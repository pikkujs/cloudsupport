import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildData } from './build.mjs'

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cloudsupport-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

const EDGE = `package: "@pikku/a"
entries:
  - versions: "*"
    cloud: { edge: [cloudflare-workers], serverless: true }
    source: somewhere
`

test('builds every package, sorted, without the source field', () => {
  const root = tree({
    'packages/@pikku/b.yaml': EDGE.replace('@pikku/a', '@pikku/b'),
    'packages/@pikku/a.yaml': EDGE,
  })
  const data = buildData(root)
  assert.equal(data.schemaVersion, 1)
  assert.deepEqual(Object.keys(data.packages), ['@pikku/a', '@pikku/b'])
  assert.deepEqual(data.packages['@pikku/a'], [
    { versions: '*', cloud: { edge: ['cloudflare-workers'], serverless: true } },
  ])
})

test('refuses to build invalid data', () => {
  const root = tree({ 'packages/@pikku/a.yaml': EDGE.replace('serverless: true', 'serverless: false') })
  assert.throws(() => buildData(root), /cannot build/)
})

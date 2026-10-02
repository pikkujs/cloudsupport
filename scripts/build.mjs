// Compiles packages/**/*.yaml into one JSON file that tools read without a YAML
// parser. Refuses to build when validation fails.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateTree, listPackageFiles } from './validate.mjs'

export const SCHEMA_VERSION = 1

export function buildData(root) {
  const { errors } = validateTree(root)
  if (errors.length > 0) {
    throw new Error(`cannot build, the data is invalid:\n${errors.map((e) => `  ${e}`).join('\n')}`)
  }
  const packages = {}
  for (const file of listPackageFiles(root)) {
    const doc = parse(readFileSync(join(root, file), 'utf8'))
    packages[doc.package] = doc.entries.map(({ source: _source, ...entry }) => entry)
  }
  const sorted = Object.fromEntries(Object.entries(packages).sort(([a], [b]) => a.localeCompare(b)))
  return { schemaVersion: SCHEMA_VERSION, packages: sorted }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out = process.argv[2] ?? join(root, 'dist', 'cloudsupport.json')
  const data = buildData(root)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
  console.log(`✔ wrote ${Object.keys(data.packages).length} packages to ${out}`)
}

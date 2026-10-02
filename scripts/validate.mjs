// Validates every packages/**/*.yaml. Deterministic: it reads files and checks
// them against the rules below, so it can run on every pull request in CI.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import semver from 'semver'

export const EDGE_PLATFORMS = ['cloudflare-workers', 'vercel-edge', 'deno-deploy']
export const RUNTIMES = ['node', 'bun', 'deno']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const checkKeys = (obj, allowed, where, errors) => {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`)
    }
  }
}

/** A `cloud` block: edge platforms (or false) and serverless (true/false). */
function checkCloud(cloud, where, errors) {
  if (!isObject(cloud)) {
    errors.push(`${where}: must be an object with "edge" and "serverless"`)
    return
  }
  checkKeys(cloud, ['edge', 'serverless'], where, errors)
  const { edge, serverless } = cloud
  if (typeof serverless !== 'boolean') {
    errors.push(`${where}.serverless: must be true or false`)
  }
  if (edge !== false && !Array.isArray(edge)) {
    errors.push(`${where}.edge: must be false or a list of platforms`)
    return
  }
  if (Array.isArray(edge)) {
    if (edge.length === 0) {
      errors.push(`${where}.edge: an empty list; write false instead`)
    }
    for (const platform of edge) {
      if (!EDGE_PLATFORMS.includes(platform)) {
        errors.push(
          `${where}.edge: unknown platform ${JSON.stringify(platform)} (known: ${EDGE_PLATFORMS.join(', ')})`
        )
      }
    }
    if (new Set(edge).size !== edge.length) {
      errors.push(`${where}.edge: lists a platform twice`)
    }
    // Every edge runtime is also a valid serverless one: the tiers nest.
    if (serverless === false) {
      errors.push(`${where}: edge support implies serverless support, but serverless is false`)
    }
  }
}

const unsupported = (cloud) =>
  isObject(cloud) && (cloud.edge === false || cloud.serverless === false)

/** Validate one parsed package file. Returns a list of problems. */
export function validatePackage(doc, file) {
  const errors = []
  if (!isObject(doc)) return [`${file}: must be a YAML mapping`]
  checkKeys(doc, ['package', 'entries'], file, errors)

  if (typeof doc.package !== 'string' || doc.package === '') {
    errors.push(`${file}: "package" must be the package name`)
  } else if (file !== `packages/${doc.package}.yaml`) {
    errors.push(`${file}: "package" is ${doc.package}, so the file must be packages/${doc.package}.yaml`)
  }

  if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
    errors.push(`${file}: "entries" must be a non-empty list`)
    return errors
  }

  const ranges = []
  doc.entries.forEach((entry, i) => {
    const where = `${file} entries[${i}]`
    if (!isObject(entry)) {
      errors.push(`${where}: must be a mapping`)
      return
    }
    checkKeys(entry, ['versions', 'cloud', 'runtime', 'exports', 'reason', 'source'], where, errors)

    if (typeof entry.versions !== 'string' || semver.validRange(entry.versions) === null) {
      errors.push(`${where}.versions: ${JSON.stringify(entry.versions)} is not a valid semver range`)
    } else {
      ranges.push({ i, range: entry.versions })
    }

    checkCloud(entry.cloud, `${where}.cloud`, errors)

    if (entry.runtime !== undefined) {
      if (!Array.isArray(entry.runtime) || entry.runtime.length === 0) {
        errors.push(`${where}.runtime: must be a non-empty list of ${RUNTIMES.join(' | ')}`)
      } else {
        for (const r of entry.runtime) {
          if (!RUNTIMES.includes(r)) {
            errors.push(`${where}.runtime: unknown runtime ${JSON.stringify(r)} (known: ${RUNTIMES.join(', ')})`)
          }
        }
      }
    }

    let narrows = unsupported(entry.cloud)
    if (entry.exports !== undefined) {
      if (!isObject(entry.exports)) {
        errors.push(`${where}.exports: must map subpaths to cloud blocks`)
      } else {
        for (const [subpath, block] of Object.entries(entry.exports)) {
          if (subpath !== '.' && !subpath.startsWith('./')) {
            errors.push(`${where}.exports: key ${JSON.stringify(subpath)} must be "." or start with "./"`)
          }
          if (!isObject(block)) {
            errors.push(`${where}.exports[${JSON.stringify(subpath)}]: must be a mapping with "cloud"`)
            continue
          }
          checkKeys(block, ['cloud'], `${where}.exports[${JSON.stringify(subpath)}]`, errors)
          checkCloud(block.cloud, `${where}.exports[${JSON.stringify(subpath)}].cloud`, errors)
          narrows ||= unsupported(block.cloud)
        }
      }
    }

    if (entry.reason !== undefined && (typeof entry.reason !== 'string' || entry.reason.trim() === '')) {
      errors.push(`${where}.reason: must be a non-empty string`)
    } else if (narrows && entry.reason === undefined) {
      errors.push(`${where}: says something is not supported, so it needs a "reason"`)
    }
  })

  for (let a = 0; a < ranges.length; a++) {
    for (let b = a + 1; b < ranges.length; b++) {
      if (semver.intersects(ranges[a].range, ranges[b].range)) {
        errors.push(
          `${file}: entries[${ranges[a].i}] (${ranges[a].range}) and entries[${ranges[b].i}] (${ranges[b].range}) overlap, so a version could match both`
        )
      }
    }
  }
  return errors
}

function listYaml(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...listYaml(path))
    else out.push(path)
  }
  return out
}

/** Repo-relative paths (`packages/@pikku/core.yaml`) of every file under `root/packages`. */
export function listPackageFiles(root) {
  return listYaml(join(root, 'packages')).map((abs) => relative(root, abs).split(sep).join('/'))
}

/** Validate every file under `root/packages`. Returns { files, errors }. */
export function validateTree(root) {
  const errors = []
  const names = new Map()
  const files = listYaml(join(root, 'packages'))
  for (const abs of files) {
    const file = relative(root, abs).split(sep).join('/')
    if (!file.endsWith('.yaml')) {
      errors.push(`${file}: only .yaml files belong under packages/`)
      continue
    }
    let doc
    try {
      doc = parse(readFileSync(abs, 'utf8'))
    } catch (error) {
      errors.push(`${file}: not valid YAML (${error.message.split('\n')[0]})`)
      continue
    }
    errors.push(...validatePackage(doc, file))
    if (isObject(doc) && typeof doc.package === 'string') {
      if (names.has(doc.package)) {
        errors.push(`${file}: ${doc.package} is already described in ${names.get(doc.package)}`)
      }
      names.set(doc.package, file)
    }
  }
  return { files: files.length, errors }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { files, errors } = validateTree(root)
  if (errors.length > 0) {
    console.error(errors.map((e) => `✖ ${e}`).join('\n'))
    console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`)
    process.exit(1)
  }
  console.log(`✔ ${files} package file${files === 1 ? '' : 's'} valid`)
}

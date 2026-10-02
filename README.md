# cloudsupport

Which packages run where. One YAML file per package under `packages/`, checked
by CI on every pull request.

Pikku's deploy planner and runtime-tier verifier read this data to decide
whether a deployed unit can run on an edge runtime (for example Cloudflare
Workers), a serverless function, or only on a server.

## The three tiers

| Tier | Where it runs | Notes |
| --- | --- | --- |
| edge | Web-API-only runtimes (Cloudflare Workers, ...) | no `node:*`, no `Buffer`, no `process` |
| serverless | a function runtime with Node built-ins (Lambda, Workers with `nodejs_compat`) | the process is frozen between calls: no timers or background work you can rely on |
| server | a long-running process (ECS, EC2, a VM, a container) | anything Node can do; **there are no server entries**, a server just works |

Edge support implies serverless support, which implies server.

A package with no file is not assumed to work anywhere but a Node server.

## A file

`packages/@pikku/better-auth.yaml`:

```yaml
package: "@pikku/better-auth"
entries:
  - versions: "*"              # semver range of the installed version
    cloud:
      edge: false              # false, or the platforms it is verified on
      serverless: true
    reason: >                  # required whenever something is false
      statically imports @better-auth/utils/password, whose workerd condition
      resolves to password.node.mjs (node:crypto scrypt)
    source: pikkujs/pikku#1962 # optional: where the claim comes from
```

| Key | Meaning |
| --- | --- |
| `package` | the npm name; the file must be `packages/<name>.yaml` |
| `versions` | semver range; ranges within a file must not overlap |
| `cloud.edge` | `false`, or a list of: `cloudflare-workers`, `vercel-edge`, `deno-deploy` |
| `cloud.serverless` | `true` or `false` |
| `runtime` | optional: `node`, `bun`, `deno`. Absent means Node only |
| `exports` | optional per-subpath override: `"./fetch": { cloud: { ... } }` |
| `reason` | required when `edge` or `serverless` is false anywhere in the entry |
| `source` | optional: an issue, PR or doc that backs the claim |

## Contributing

Open a pull request that adds or changes a file under `packages/`. CI runs:

- `npm run validate`: schema, version ranges that do not overlap, platform and
  runtime names from the known lists, a reason for every "no", and the file path
  matching the package name.
- `npm test`: the validator's own tests.

To run it locally: `npm ci && npm run validate && npm test`.

Claims should come from somewhere checkable: a bundle under the target's
profile, the platform's documentation, or an issue. Say which in `reason` or
`source`.

## Status

The first 21 files were generated from the `"pikku": { "runtime" }` blocks of
the built-in packages in pikkujs/pikku#1962, so the data matches what that
branch verifies today. They have not been re-audited since.

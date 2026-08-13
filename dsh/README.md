# Amber Protocol — dsh Integration

Amber Protocol ships as an installable **dsh bundle** named `dsh-amber-protocol`.
Installing it with the native profile plugin command adds one declared dsh bundle
layer that resolves its own installed location, starts Amber's stdio MCP server,
exposes Amber skills through dsh's filesystem skill provider, and governs the
workspace at `process.cwd()` by default.

Amber is discoverable on the official [`dsh-plugin`](https://github.com/topics/dsh-plugin)
topic.

## Install (recommended)

```bash
# Install once; dsh adds the Amber bundle layer to your profile.
# This modifies only dependency and bundle declarations managed by dsh;
# it does NOT write the profile's patch file.
dsh plugin --profile web add dsh-amber-protocol

# Ordinary startup loads Amber after install (no repeated --patch flag).
dsh --profile web
```

On Windows, default port `3080` is often in a reserved range. If listen fails
with `EACCES`, pass `--port 13080`.

## What you get

### MCP tools

The dsh agent gains 10 governed tools under the stable `amber` server namespace
(prefixed `mcp__amber__`):

- `amber.governance.report` — readiness score, risks, next actions
- `amber.session.start` / `status` / `approve` / `verify` — session lifecycle
- `amber.context.ingest` / `amber.object.query` — context knowledge lifecycle
- `amber.route.test` — route validation
- `amber.fn.repoOverview` / `amber.fn.sessionEvidence` — function queries

All mutating operations (session start, approve, context ingest) return
`approvalRequired: true` — dsh must explicitly approve them. Read-only
operations execute directly. This is the F018 fail-closed governance seam.

### Journey skills

The dsh agent gains 5 skills discoverable through the native skill
catalog (4 journeys plus the `amber` router that dispatches to them):

- `amber-delivery` — objective → plan → session evidence → acceptance
- `amber-diagnosis-adoption` — audit readiness, adopt or repair governance
- `amber-context-continuity` — distill context, verify loadouts, resume
- `amber-continuous-improvement` — select next improvement slice, loop

## Bundle structure

| File               | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `package.json`     | Bundle manifest; declares `dsh.bundle.patch` + `files` contract   |
| `cordis.patch.yml` | Declarative dsh patch layer (runtime, MCP client, skill provider) |
| `runtime.js`       | Path-resolution adapter; exposes `amberBundlePaths` service       |
| `README.md`        | This file                                                         |
| `LICENSE`          | MIT                                                               |

The runtime resolves `amber-protocol` from its own installed module location
(`require.resolve("amber-protocol/package.json")`) and exposes the MCP script
and skills directory to later bundle rows. Configuration expressions do not
rely on `__dirname`, `require`, a hard-coded profile name, or a global install.

## Unpublished checkout fallback (overlay)

If you are developing Amber itself and the bundle is not yet published, use
the static overlay patches instead. These are **not** shipped in the bundle
`files` array — they exist only for local development.

**Alternative — local tarball install with pnpm overrides:** if you want to
test the bundle contract (not the overlay) against an unpublished `1.5.1`
tarball, `dsh plugin add` forwards to pnpm. When `amber-protocol@1.5.1` is
not yet on the registry, add a pnpm `overrides` entry so the bundle's
`amber-protocol@^1.5.1` dependency resolves from the local tarball instead of
the registry (which still has `1.5.0`):

```yaml
# In the profile's pnpm-workspace.yaml (dsh creates this on first init):
overrides:
  amber-protocol: file:/path/to/amber-protocol-1.5.1.tgz
```

Then:

```sh
dsh plugin --profile web add /path/to/amber-protocol-1.5.1.tgz
dsh plugin --profile web add /path/to/dsh-amber-protocol-1.5.1.tgz
```

Once `1.5.1` is published, plain `dsh plugin --profile web add dsh-amber-protocol`
works without overrides.

### Overlay patches

| File                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `amber-mcp.patch.yml`    | Path A — expose Amber governance tools via MCP server |
| `amber-skills.patch.yml` | Path B — expose Amber journey skills to the dsh agent |
| `amber-full.patch.yml`   | A + B combined in one layer                           |

### Prerequisites (overlay only)

1. **dsh installed**: `npm install -g @deepseek-ai/dsh` (or `npx @deepseek-ai/dsh`)
2. **A dsh profile**: `dsh --profile web` auto-initializes on first use
3. **This checkout**: you need a local clone so the patch can point at
   `scripts/amber-mcp.js` and `skills/`
4. **Amber in the target repo** (if it is not this checkout):
   `node scripts/amber.js init --target <repo>`

### Overlay usage

Edit `amber-full.patch.yml` first: replace `/path/to/amber-protocol` with this
checkout. `--target` is the repository Amber should govern (it may differ from
this checkout).

Recommended — overlay at launch, leave the profile file untouched:

```sh
dsh --profile web --patch /path/to/amber-protocol/dsh/amber-full.patch.yml
```

Alternative — copy into the profile layer (overwrites an empty or existing
`cordis.patch.yml`):

```sh
cp dsh/amber-full.patch.yml "$DSH_HOME/profiles/web/cordis.patch.yml"
dsh --profile web
```

The overlay patches use hardcoded absolute paths. Adjust the two paths in each
patch file:

- **`scripts/amber-mcp.js` path**: point to your `amber-protocol` checkout
- **`skills` path**: point to the `skills` directory under the same checkout
- **`--target` path**: the repository Amber governs (can differ from the
  `amber-protocol` checkout)

### HMR

dsh watches `cordis.patch.yml` for changes. Editing the patch file triggers
hot-reload: the MCP client disconnects and reconnects, and skill directories
are re-scanned — no restart needed.

## Verified

- MCP server responds to `initialize` + `tools/list` (10 tools)
- Read-only tools (`governance.report`) execute directly (`approvalRequired: false`)
- Mutating tools (`session.start`) fail-closed (`approvalRequired: true`, `executed: false`)
- Skills match dsh `SKILL.md` frontmatter format (5 skills, kebab-case names)
- `dsh --dump-config` composes the bundle layer with zero errors
- `npm pack --dry-run` ships every declared asset (`cordis.patch.yml`, `runtime.js`,
  `README.md`, `LICENSE`, `package.json`)

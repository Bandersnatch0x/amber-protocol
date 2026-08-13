# Amber Protocol dsh Integration

This directory contains Cordis patch layers for integrating Amber Protocol into
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

## Files

| File                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `amber-mcp.patch.yml`    | Path A — expose Amber governance tools via MCP server |
| `amber-skills.patch.yml` | Path B — expose Amber journey skills to the dsh agent |
| `amber-full.patch.yml`   | A + B combined in one layer                           |

## Prerequisites

1. **dsh installed**: `npm install -g @deepseek-ai/dsh` (or `npx @deepseek-ai/dsh`)
2. **A dsh profile**: `dsh --profile web` (auto-initializes on first use), or create a custom one with `dsh plugin --profile amber`
3. **Amber installed in the target repo**: `node scripts/amber.js init --target <repo>`

## Quick start

Copy the combined patch into your profile's `cordis.patch.yml`:

```sh
# For the default 'web' profile:
cp dsh/amber-full.patch.yml "$DSH_HOME/profiles/web/cordis.patch.yml"

# Or for a custom 'amber' profile:
dsh plugin --profile amber
cp dsh/amber-full.patch.yml "$DSH_HOME/profiles/amber/cordis.patch.yml"
dsh --profile amber web
```

Then edit the `command`/`args` paths in the patch to point at your
`coding-harness` checkout and target repository.

## What you get

### Path A — MCP tools

The dsh agent gains 10 governed tools prefixed `mcp__amber__`:

- `amber.governance.report` — readiness score, risks, next actions
- `amber.session.start` / `status` / `approve` / `verify` — session lifecycle
- `amber.context.ingest` / `amber.object.query` — context knowledge lifecycle
- `amber.route.test` — route validation
- `amber.fn.repoOverview` / `amber.fn.sessionEvidence` — function queries

All mutating operations (session start, approve, context ingest) return
`approvalRequired: true` — dsh must explicitly approve them. Read-only
operations execute directly. This is the F018 fail-closed governance seam.

### Path B — Journey skills

The dsh agent gains 4 journey skills discoverable via the skill system:

- `amber-delivery` — objective → plan → session evidence → acceptance
- `amber-diagnosis-adoption` — audit readiness, adopt or repair governance
- `amber-context-continuity` — distill context, verify loadouts, resume
- `amber-continuous-improvement` — select next improvement slice, loop

## Configuration

The patch files use hardcoded absolute paths. Adjust the two paths in each
patch file:

- **`scripts/amber-mcp.js` path**: point to your `coding-harness` checkout
- **`skills` path**: point to the `skills` directory under the same checkout
- **`--target` path**: the repository Amber governs (can differ from the
  `coding-harness` checkout)

```yaml
# In the patch file, replace:
command: node
args:
  - "/path/to/coding-harness/scripts/amber-mcp.js"
  - --target
  - "/path/to/coding-harness"
# With your actual paths.
```

### Patch syntax

The patch files use dsh's native Cordis patch format:

- **`- insert:`** adds new plugin rows (used for `mcp-amber`)
- **`- id: <existing>`** overrides an existing row's config (used for
  `skill-filesystem`); this is the flat id-targeted override syntax, not a
  nested `update:` key

See `amber-full.patch.yml` for the combined layer.

## HMR

dsh watches `cordis.patch.yml` for changes. Editing the patch file triggers
hot-reload: the MCP client disconnects and reconnects, and skill directories
are re-scanned — no restart needed.

## Verified

- MCP server responds to `initialize` + `tools/list` (10 tools)
- Read-only tools (`governance.report`) execute directly (`approvalRequired: false`)
- Mutating tools (`session.start`) fail-closed (`approvalRequired: true`, `executed: false`)
- Skills match dsh `SKILL.md` frontmatter format (5 skills, kebab-case names)
- `dsh --dump-config` composes both patches with zero errors

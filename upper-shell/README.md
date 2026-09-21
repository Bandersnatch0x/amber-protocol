# Amber Upper Shell (MVP)

A small TypeScript agent loop that **consumes** Amber Protocol over MCP.
It does not replace Amber governance: mutating Amber tools that return
`approvalRequired` stop at a human y/n bridge. The shell never writes `.amber/`
itself.

Slices: **S1** model adapter · **S2** MCP client · **S3** agent loop ·
**S4** tool registry · **S5** session bind · **S6** approval bridge · **S7** handoff.

## Install

```bash
cd upper-shell
npm install
```

Requires Node ≥ 18. Live runs need `OPENAI_API_KEY`. Unit tests do not.

## Run

From `upper-shell/`:

```bash
npx tsx src/index.ts --target /path/to/repo --objective "audit this repository"
# or
npm start -- --target /path/to/repo --objective "audit this repository"
```

After `npm link` (or `npm install` at this package):

```bash
upper-shell --target /path/to/repo --objective "..." [--max-turns 12] [--agent-id upper-shell]
```

Amber root defaults to the parent of `upper-shell/` (`…/amber-protocol`). Override
with `AMBER_ROOT` or `--amber-root`.

`--execute` acknowledges MCP execution intent. Mutating Amber actions still
return `approvalRequired` and still require the Approval Bridge.

### Environment

| Variable          | Default                         | Purpose               |
| ----------------- | ------------------------------- | --------------------- |
| `OPENAI_API_KEY`  | (required for live model calls) | API key               |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1`     | OpenAI-compatible API |
| `OPENAI_MODEL`    | `gpt-4o-mini`                   | Chat model            |
| `AMBER_ROOT`      | parent of `upper-shell/`        | Amber Protocol root   |

## Tests

```bash
npm test
```

Uses `node:test` + `tsx`. No live OpenAI key and no real Amber session required.

## How it talks to Amber

1. Spawns `node scripts/amber-mcp.js --target <repo>` (stdio JSON-RPC 2.0).
2. `initialize` → `tools/list` → registers tools as OpenAI functions.
3. `amber.session.start` via `tools/call` (Approval Bridge if `approvalRequired`).
4. Sequential turns: model → tool calls → MCP `tools/call` → tool results.
5. If a tool result is `approvalRequired`, print a summary and wait for `y/n`.
   On **y**, spawn the rendered `commandArgv` through `scripts/amber.js`.
   On **n**, append a denial and continue. Never auto-approves.
6. Best-effort `amber handoff bundle` + `handoff validate` at the end.

Read-only Amber tools execute through MCP. Mutations never go around the bridge.

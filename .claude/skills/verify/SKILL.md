---
name: verify
description: Drive Amber Protocol's `amber` CLI (and, secondarily, its Web Viewer) to prove behavior end to end — launch, run the governed lifecycle commands against a disposable target repo, and capture repo-file evidence. Use when you must verify an Amber change by exercising the real CLI rather than trusting unit tests, or when a proof of user-visible behavior is required before handoff.
---

# Verify Amber Protocol

Amber is a **repository-local governance CLI**. The primary user surface is the `amber`
command run from a terminal; the secondary surface is the Phase C Web Viewer (`apps/web`).
Almost every claim about Amber behavior is a claim about what `amber <verb>` writes to a
target repository's files and prints to stdout — so verification means **running the real
CLI against a disposable target repo and reading the files it produced**, not calling
internal functions or asserting on unit-test doubles.

The feature map in [`features/`](./features/README.md) is the maintained source for what to
drive. Read its index before driving; a proof that exercises one convenient command is
incomplete when the map lists other entry points for the same feature.

## Launch

The CLI is a short-lived process — there is no server to keep alive, no port, and no seed
data. "Launch" is just confirming the entry point runs:

```bash
# From the repo root (no install needed):
node scripts/amber.js --version      # -> 2.0.1

# Or, after `npm install -g amber-protocol`:
amber --version
```

Anything that `amber` prints is a fresh process exit; there is nothing to tear down.

**Secondary surface — Web Viewer** (`apps/web`, Vite + React + Express + tRPC). Only reach
for it when the claim is about the browser UI (timeline, gates, routes, knowledge pages):

```bash
# Terminal 1 — API + Vite dev server (client 5173, API defaults to 3001, probes upward)
npm --prefix apps/web run dev
# Ready when: curl -s http://127.0.0.1:3001/api/health  ->  {"ok":true,...}
```

Pin the API port with `PORT=<n>` when 3001 is taken, and point the viewer at a repo with
`AMBER_REPO_ROOT=<path>` (defaults to the nearest ancestor `package.json` named
`amber-protocol`). Teardown for this surface is in **Cleanup**.

## Doctor

One read-only check that answers "is this checkout worth driving?":

```bash
node scripts/amber.js --version            # the entry point runs at all
node scripts/amber.js doctor --target .    # this repo is healthy: "Errors: 0", exit 0
```

`doctor --target .` reads this repository's own governance files and writes nothing. If it
reports errors, fix the checkout before driving — a skill run against a broken base teaches
wrong steps. For the Web Viewer, the doctor is the health probe above: it must return
`"ok":true` and an `amberRepoRoot` pointing at the repo you meant to inspect.

## Drive

The harness is the `amber` CLI itself. Drive it against a **disposable target repo** so
verification never touches this repository's own `.amber/` state:

```bash
# Isolated target (Git Bash on Windows needs the cygpath hop — node wants a Windows path)
TMPD="$(mktemp -d)"; T="$(cygpath -w "$TMPD")"
# PowerShell equivalent:
#   $T = Join-Path $env:TEMP ("amber-verify-" + [guid]::NewGuid()); New-Item -ItemType Directory $T | Out-Null

node scripts/amber.js init --target "$T"                      # scaffold governance files
node scripts/amber.js doctor --target "$T"                    # -> Errors: 0
node scripts/amber.js next --target "$T" --json               # machine-readable next step
node scripts/amber.js session start --goal "verify probe" --target "$T" --yes
node scripts/amber.js plan --feature F001 --title "Slice" --target "$T" --yes
node scripts/amber.js handoff --target "$T"
```

Rules that keep a drive honest:

- **Typed mutations require `--yes` (or `--confirm`).** `session start`, `plan`, and other
  governed writes print `Executed: false` and exit `1` without it. Never treat a mutation as
  done because the text looked plausible — check the exit code, or read `executed` in `--json`.
- **`--json` is the machine-readable face** of every command. Prefer it for assertions; the
  human text is for reading.
- **Never write governance files by hand** to make a check pass. Drive the command that owns
  the file, then read the file it produced.
- **`--target` isolates everything.** One temp target per run lets two runs (or two agents)
  proceed side by side. The CLI has no shared global state.

## Evidence

A proof captures the **action and the resulting state**, not just the final screen:

- **stdout / stderr / exit code** of each command, verbatim (commands are literal — keep
  quoted goals and flags unchanged).
- **`--json` output** where a command offers it.
- **The files the command wrote**, read back from the target: session state under
  `<T>/.amber/sessions/<id>/` (`manifest.json`, `timeline.jsonl`, `gates/*.gate.json`),
  plans under `<T>/docs/plans/`, and `<T>/session-handoff.md`.
- **Side-effect checks** alongside the visible output: a `plan` proof must show the plan file
  on disk, not merely "Created: 1" on stdout.

Proof artifacts go to **`.amber/tmp/verify/<run-id>/`** in this repo (already git-ignored, so
they never pollute a commit) and **survive teardown** — cleanup removes the disposable target
and any web instance, never the evidence.

When a command claims a safe path (a `--dry-run`, a read-only check), verify what it actually
skipped by observing the filesystem, not the flag name.

## Cleanup

Kill only what this run started; never kill by process name.

```bash
rm -rf "$TMPD"                      # the disposable target (evidence lives elsewhere)
```

For the Web Viewer, record the PID you launched and stop exactly that process — on Windows:

```powershell
$conns = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force }
```

Confirm the port is free afterwards. Then re-check that the proof artifacts in
`.amber/tmp/verify/<run-id>/` still exist — a cleanup that eats the proof fails the run.

## Helpers

This skill ships **no scripts**: the `amber` CLI is the harness, and every recipe in the
feature map is a literal `amber` command plus a file read. Copy them as-is.

## Features

See the [feature map index](./features/README.md) for the per-feature recipes.

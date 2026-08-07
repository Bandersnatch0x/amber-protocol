---
name: amber-context
description: Run Amber Context when distilling provenance-backed Context Pages, refreshing stale knowledge, or assembling a task-scoped Loadout with verified Required Artifacts.
x-amber-json: {"command":"node scripts/amber.js context {{action}} --target {{target}}","args":[{"name":"action","hint":"request|ingest|verify|list|show|refresh|stats|delete|load"},{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-context"}
---

# Amber Context

Use for the ADR-0009 write path and ADR-0010/0015 task-scoped Loadout path. **Amber owns contracts, selection, and gates; the host agent owns generation and loading.**

> Command prefix: in an Amber checkout run `node scripts/amber.js`; when Amber is installed as a package (npm, pi, Claude Code) run `npx -p amber-protocol amber`.

## Division of labour — read this first

- **Amber never calls a model.** `amber context request` writes a distillation contract (hash-bearing sources + output schema + hard constraints + acceptance codes) to `.amber/context/requests/`.
- **You execute the contract with your own model**: read the request JSON, produce a payload matching `schemas/context-page.schema.json`, and feed it to `amber context ingest`.
- **Amber judges.** `ingest` validates schema, citation completeness, request binding, request-owned scope, and source freshness, and refuses anything that fails.
- **Amber confines.** Every source, request, payload, Page, Loadout, and Required Artifact must resolve inside `--target`, including through symlinks and junctions.

## Workflow

1. **Inspect the queue**: `amber context list --target <repo>` and `amber context verify --target <repo>`.
2. **Request**: `amber context request --target <repo> --page <id> [--title <t>] [--source <ref>]` — bundles evidence, writes the contract. Auto-bundles the most recent session ledger when no `--source` is given. Refs under `.amber/` and `docs/adr/` are immutable (excerpt-snapshotted); everything else is mutable.
3. **Execute the contract**: read `.amber/context/requests/<id>.json`. Every block must cite at least one source id from the `sources` map — copy the source descriptors **verbatim** (Amber compares hashes to the request bundle; re-hashing is rejected as stale). If the evidence does not cover something, write it as `{"type":"unknown"}` — never invent a citation.
4. **Ingest**: `amber context ingest --target <repo> --request <id> --payload <file.json>`.
   - If a source changed but your judgement is the page's claims are unaffected, submit `{"outcome":"no-change","pageId":"<id>"}` to rebase hashes without touching content.
5. **Keep the loop closed**: run `amber context refresh --target <repo>` periodically — it absorbs cosmetic changes silently and generates refresh requests for real ones. Re-run steps 3–4 for each.
6. **Build a Loadout**: `amber context load --target <repo> --route <id> [--feature <id>] [--budget <words>] [--page <page-id>]`. Inspect `artifacts.required[]` separately from Context Page `references`, then run `amber context verify --target <repo> --loadout <file>` immediately before loading it.
7. **Watch the numbers**: `amber context stats --target <repo>` — filter rate, pass rate, no-change rate, unknown-block share.

## Contract instructions (what the request expects of you)

- Cite every claim to at least one declared source id.
- Never introduce facts beyond the sources; never invent a citation.
- Mark anything the sources do not cover as `type:"unknown"`.
- Reproduce the request's source descriptors exactly (ref, hashes, excerpt) — do not re-bundle.
- Treat the Distillation Contract as authority: page id, source set, and scope must be equal to or narrower than the request; a payload cannot grant itself scope.

## Boundary

The Context layer is governance over knowledge, not a knowledge server. `ingest`/`verify`/`refresh`/`load` are deterministic and offline; generation is done by whichever agent holds the contract. Pages live in `.amber/context/pages/`; `docs/wiki/context-index.md` is the one generated wiki file — never edit it by hand. A Loadout uses `schemaVersion: 1.0.0` and always carries three target-local Required Artifacts: the Operating Manual, selected Route manifest, and Loadout Definition.

## Error codes

- `AMBER_E_CONTEXT_SCHEMA_INVALID` — payload fails the page schema (or pageId mismatch with the request).
- `AMBER_E_CONTEXT_REQUEST_MISSING` / `AMBER_E_CONTEXT_REQUEST_MISMATCH` — the Distillation Contract is absent or the payload exceeds its authority.
- `AMBER_E_CONTEXT_CLAIM_UNCITED` — a block cites a source id the page never declares.
- `AMBER_E_CONTEXT_SOURCE_STALE` — a mutable source changed since the request (or you re-bundled hashes).
- `AMBER_E_CONTEXT_SOURCE_TAMPERED` — an immutable source no longer matches its excerpt, or the embedded excerpt fails its own hash.
- `AMBER_E_CONTEXT_SOURCE_MISSING` — a referenced source is gone.
- `AMBER_E_CONTEXT_PAGE_ORPHANED` / `AMBER_E_CONTEXT_PAGE_OBSOLETE` — page absent from the index / all its sources are gone.
- `AMBER_E_CONTEXT_LOADOUT_ROUTE` / `AMBER_E_CONTEXT_LOADOUT_MISSING` / `AMBER_E_CONTEXT_LOADOUT_CORRUPT` — the Route or Loadout file cannot be read and validated.
- `AMBER_E_CONTEXT_LOADOUT_REQUIRED` / `AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW` — Required Artifacts or the budget cannot produce a valid Loadout.

---
name: amber-context
description: Run the Amber Protocol Context layer (ADR-0009) — emit distillation contracts, execute them with your own model, and gate the result at ingest. Closes the write path so session evidence becomes provenance-backed knowledge pages instead of sinking.
x-amber-json: {"command":"node scripts/amber.js context {{action}} --target {{target}}","args":[{"name":"action","hint":"request|ingest|verify|list|show|refresh|stats|delete"},{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-context"}
---

# Amber Context

Use when a user asks to distill project knowledge from session evidence, refresh stale knowledge pages, or run the Context-layer loop. Implements ADR-0009: **Amber owns the contract and the gate; the host agent owns the generation.**

> Command prefix: in an Amber checkout run `node scripts/amber.js`; when Amber is installed as a package (npm, pi, Claude Code) run `npx -p amber-protocol amber`.

## Division of labour — read this first

- **Amber never calls a model.** `amber context request` writes a distillation contract (hash-bearing sources + output schema + hard constraints + acceptance codes) to `.amber/context/requests/`.
- **You execute the contract with your own model**: read the request JSON, produce a payload matching `schemas/context-page.schema.json`, and feed it to `amber context ingest`.
- **Amber judges.** `ingest` validates schema, citation completeness, payload-to-request binding, and source freshness, and refuses anything that fails.

## Workflow

1. **Inspect the queue**: `amber context list --target <repo>` and `amber context verify --target <repo>`.
2. **Request**: `amber context request --target <repo> --page <id> [--title <t>] [--source <ref>]` — bundles evidence, writes the contract. Auto-bundles the most recent session ledger when no `--source` is given. Refs under `.amber/` and `docs/adr/` are immutable (excerpt-snapshotted); everything else is mutable.
3. **Execute the contract**: read `.amber/context/requests/<id>.json`. Every block must cite at least one source id from the `sources` map — copy the source descriptors **verbatim** (Amber compares hashes to the request bundle; re-hashing is rejected as stale). If the evidence does not cover something, write it as `{"type":"unknown"}` — never invent a citation.
4. **Ingest**: `amber context ingest --target <repo> --request <id> --payload <file.json>`.
   - If a source changed but your judgement is the page's claims are unaffected, submit `{"outcome":"no-change","pageId":"<id>"}` to rebase hashes without touching content.
5. **Keep the loop closed**: run `amber context refresh --target <repo>` periodically — it absorbs cosmetic changes silently and generates refresh requests for real ones. Re-run steps 3–4 for each.
6. **Watch the numbers**: `amber context stats --target <repo>` — filter rate, pass rate, no-change rate, unknown-block share.

## Contract instructions (what the request expects of you)

- Cite every claim to at least one declared source id.
- Never introduce facts beyond the sources; never invent a citation.
- Mark anything the sources do not cover as `type:"unknown"`.
- Reproduce the request's source descriptors exactly (ref, hashes, excerpt) — do not re-bundle.

## Boundary

The Context layer is governance over knowledge, not a knowledge server. `ingest`/`verify`/`refresh` are deterministic and offline; generation is done by whichever agent holds the contract. Pages live in `.amber/context/pages/`; `docs/wiki/context-index.md` is the one generated wiki file — never edit it by hand.

## Error codes

- `AMBER_E_CONTEXT_SCHEMA_INVALID` — payload fails the page schema (or pageId mismatch with the request).
- `AMBER_E_CONTEXT_CLAIM_UNCITED` — a block cites a source id the page never declares.
- `AMBER_E_CONTEXT_SOURCE_STALE` — a mutable source changed since the request (or you re-bundled hashes).
- `AMBER_E_CONTEXT_SOURCE_TAMPERED` — an immutable source no longer matches its excerpt, or the embedded excerpt fails its own hash.
- `AMBER_E_CONTEXT_SOURCE_MISSING` — a referenced source is gone.
- `AMBER_E_CONTEXT_PAGE_ORPHANED` / `AMBER_E_CONTEXT_PAGE_OBSOLETE` — page absent from the index / all its sources are gone.

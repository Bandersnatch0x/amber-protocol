---
# GENERATED — edit skills/ instead. Run: npm run gen:agents
name: amber-context-continuity
description: Distill provenance-backed context, verify task Loadouts, and preserve resumable handoff state.
x-amber-json: {"kind":"journey","command":"node scripts/amber.js context load --route {{route}} --target {{target}}","commandName":"context-continuity","args":[{"name":"route","hint":"route id"},{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-context-continuity"}
---

# Context And Continuity

Amber owns contracts, validation, selection, and gates. The host agent owns generation and loading.

1. Inspect context requests, page verification, feature/session state, and existing handoff artifacts.
2. For durable knowledge, create a `context request`; generate only from its declared sources. Copy source descriptors exactly, cite every claim, and mark unsupported claims unknown.
3. After human review, ingest the payload through `context ingest --confirm`. Without explicit confirmation the typed CLI seam returns `approvalRequired` and performs no write. Never write a page directly or re-hash sources to evade freshness checks.
4. Run `context refresh` and resolve stale-source requests. Use no-change only when the claims truly remain valid.
5. Build a task Loadout with `context load --route <id>` and verify it immediately before use. Required Artifacts are separate from page references and may not be omitted to fit budget.
6. Before stopping, update progress, feature/session evidence, Resume Checkpoint, and `session-handoff.md`; run `handoff` validation.

Evidence order: request id and source hashes, schema-valid payload, ingest result, refresh state, Loadout path/hash, Required Artifact verification, handoff validation.

On failure, stop before the next stage, retain the request and negative validation evidence, and report the exact recovery command. Do not weaken approval, isolation, or ledger requirements to make a stale payload ingestible.

On stale, missing, escaped, or tampered sources, fail closed and request a fresh contract. On interruption, resume from the latest validated request/Loadout and handoff record, never from chat memory alone.

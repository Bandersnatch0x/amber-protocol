# Packet B - Implementation

Implementer task:

- Add status helper in `scripts/lib/harness-core.js`.
- Add `adoption status` CLI route.
- Add human-readable output.
- Write markdown status only for explicit unused `--output`.

Spec review must confirm:

- Status is read-only without `--output`.
- Index validation, gate decision, compare summary, blockers, and next safe action are included.

Quality review must confirm:

- Implementation reuses adoption list/validate/compare/gate helpers.
- Existing command outputs remain stable.

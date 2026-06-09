# Packet B - Implementation

Implementer task:

- Add parser/gate helper in `scripts/lib/harness-core.js`.
- Add `--report` argument parsing.
- Add `adoption gate` CLI route.
- Add human-readable output.

Spec review must confirm:

- Gate rules match `plan.md`.
- `--output` refuses overwrite.
- No target project is read or executed.

Quality review must confirm:

- Implementation reuses existing adoption parsing patterns.
- Error handling remains JSON-friendly.

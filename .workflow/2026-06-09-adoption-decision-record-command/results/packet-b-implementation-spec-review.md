# Packet B Spec Review

Status: APPROVED

## Review

- Command requires `--bundle-dir` and `--output`.
- Existing output paths are rejected.
- Bundle manifest is read as the source of target, latest report, gate decision, and boundaries.
- `gate.md` findings are included when available.
- Gate A/B/C are recorded as pending by default.
- V1 boundary is preserved: no target writes, no target commands, no Dynamic Workflow, no live subagents.


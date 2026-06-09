# Adoption Bundle Workflow

Goal: generate a reviewable adoption evidence bundle from existing adoption artifacts.

## Success Criteria

- `adoption bundle --reports-dir <dir> --index <file> --output-dir <dir> --json` creates a new bundle directory.
- The output directory must not already exist.
- Bundle contains:
  - `README.md`
  - `status.md`
  - `index.md`
  - `diff.md`
  - `gate.md`
  - `manifest.json`
- Manifest records generated files, source paths, target, latest report, gate decision, next safe action, and safety boundaries.
- Bundle generation reads adoption artifacts only and does not copy or mutate target project files.
- StockAgents examples can produce a bundle.
- Full verification passes.

## Boundaries

- No dynamic workflow execution.
- No live subagent runner invocation.
- No target project command execution.
- No target project file writes.
- No automatic overwrite or repair.

## Simulated Subagent Packets

- Packet A: RED tests, spec review, quality review.
- Packet B: implementation, spec review, quality review.
- Packet C: StockAgents smoke and docs, spec review, quality review.
- Packet D: final verification and workflow closeout.

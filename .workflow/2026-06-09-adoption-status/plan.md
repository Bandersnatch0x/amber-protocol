# Adoption Status Workflow

Goal: implement a read-only status summary for generated adoption artifacts.

## Success Criteria

- `adoption status --reports-dir <dir> --json` summarizes report count, latest report, gate decision, blockers, compare summary, and next safe action.
- `adoption status --reports-dir <dir> --index <file> --json` includes index validation status.
- `adoption status --reports-dir <dir> --index <file> --output <file>` writes markdown status only to an explicit unused path.
- Existing output files are never overwritten.
- StockAgents examples produce a `wait` status with blockers and a review-oriented next safe action.
- Full verification passes.

## Boundaries

- No dynamic workflow execution.
- No live subagent runner invocation.
- No target project command execution.
- No target project file writes.
- No automatic repair or overwrite.

## Simulated Subagent Packets

- Packet A: RED tests, spec review, quality review.
- Packet B: implementation, spec review, quality review.
- Packet C: StockAgents smoke and docs, spec review, quality review.
- Packet D: final verification and workflow closeout.

# Adoption Gate Workflow

Goal: implement a read-only readiness gate for generated adoption reports.

## Success Criteria

- `adoption gate --report <file> --json` evaluates one adoption report.
- `adoption gate --reports-dir <dir> --json` evaluates the latest report in a directory.
- `adoption gate --report <file> --output <file>` writes a markdown gate report only to an explicit unused path.
- Existing output files are never overwritten.
- Gate findings explain why the decision is `ready` or `wait`.
- StockAgents examples produce a conservative `wait` decision without modifying the target project.
- Full verification passes.

## Conservative Gate Rules

- `missingHarnessFiles > 0`: wait.
- `conflicts > 0`: wait.
- non-empty unknowns: wait.
- non-empty candidate commands: wait, because commands require human confirmation.
- otherwise: ready.

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

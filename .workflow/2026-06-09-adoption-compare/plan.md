# Adoption Compare Workflow

Goal: implement read-only comparison for generated adoption report artifacts.

## Success Criteria

- `adoption compare --reports-dir <dir> --json` selects the latest two reports, using the older as base and newer as head.
- `adoption compare --base <file> --head <file> --output <file>` writes a markdown diff only to the explicit output path.
- Existing output files are never overwritten.
- Comparison reports target equality, generated timestamps, audit metric deltas, candidate-command changes, and unknown changes.
- sample timestamped reports can be compared.
- Full verification passes.

## Boundaries

- No dynamic workflow execution.
- No live subagent runner invocation.
- No target project command execution.
- No target project file writes.
- No automatic repair or overwrite of report/index artifacts.

## Packets

- Packet A: RED tests.
- Packet B: core and CLI implementation.
- Packet C: sample smoke and docs.
- Packet D: verification and workflow closeout.

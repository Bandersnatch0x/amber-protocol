# Adoption Validate Workflow

Goal: implement a read-only `adoption validate` command for adoption report artifacts.

## Success Criteria

- `adoption validate --reports-dir <dir>` validates parseable adoption reports and returns report count.
- `adoption validate --reports-dir <dir> --index <file>` also checks markdown links in the index resolve to files under the reports directory.
- The command is read-only and never writes reports, indexes, or target project files.
- Broken report metadata or broken index links are reported as errors.
- sample example reports and `adoptions-index.md` validate successfully.
- Full verification passes.

## Boundaries

- No dynamic workflow execution.
- No live subagent runner invocation.
- No target project command execution.
- No automatic overwrite or repair of existing files.

## Packets

- Packet A: RED tests.
- Packet B: core and CLI implementation.
- Packet C: sample examples smoke and docs.
- Packet D: verification and workflow closeout.

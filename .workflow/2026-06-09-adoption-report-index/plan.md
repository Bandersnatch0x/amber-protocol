# Adoption Report Index Plan

Goal: make timestamped adoption reports discoverable.

Success criteria:

- `adoption list --reports-dir <dir>` lists generated report metadata without writing files.
- `adoption index --reports-dir <dir> --output <file>` writes a markdown index.
- Index generation refuses to overwrite existing files.
- Reports are sorted newest first.
- StockAgents reports under `docs/examples/adoptions/` can be listed and indexed.

Constraints:

- Do not touch target project files.
- Do not execute target project commands.
- Do not overwrite existing index files.

Verification:

- TDD with CLI tests.
- StockAgents reports smoke test.
- `npm test`.
- Workflow artifact verification.


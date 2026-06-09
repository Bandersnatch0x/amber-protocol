# Packet B - Implementation

Status: completed.

Implemented:

- `adoption list --reports-dir <dir>` in the CLI.
- `adoption index --reports-dir <dir> --output <file>` in the CLI.
- Core helpers to parse `# Coding Harness Adoption Report` markdown metadata, sort reports newest first, and build a markdown index.
- `--reports-dir` argument parsing.

Safety boundaries:

- `adoption list` only reads the reports directory.
- `adoption index` writes only the explicit `--output` path.
- Existing index files are never overwritten.
- Target projects are not initialized, edited, or executed.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `0`.

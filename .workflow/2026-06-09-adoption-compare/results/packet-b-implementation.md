# Packet B - Implementation

Status: completed.

Implemented:

- `adoption compare --reports-dir <dir>` auto-selects the latest two reports.
- `adoption compare --base <file> --head <file>` compares explicit reports.
- Optional `--output <file>` writes a markdown diff and refuses overwrite.
- JSON and human-readable output include target equality, generated order, metric deltas, candidate command changes, unknown changes, and simple status changes.

Safety boundaries:

- Directory compare is read-only.
- Markdown output is written only to an explicit unused path.
- Target projects are not read, modified, or executed.

Evidence:

- `node --test tests/harness-cli.test.js` returned status `0` after implementation.

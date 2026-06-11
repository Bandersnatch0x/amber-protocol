# Adoption Report Output Directory Plan

Goal: add `adoption report --output-dir <dir>` so real-project trial reports can be generated safely without hand-written file names.

Success criteria:

- `--output-dir` creates a markdown report in the provided directory.
- The file name includes the target basename and an adoption-report suffix.
- Repeated runs do not overwrite earlier reports.
- `--output` keeps its existing no-overwrite behavior.
- Target project files remain untouched.

Verification:

- CLI regression test.
- sample smoke test.
- `npm test`.
- Workflow artifact verification.


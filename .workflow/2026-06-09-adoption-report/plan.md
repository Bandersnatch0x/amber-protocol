# Adoption Report Workflow Plan

Goal: implement a safe adoption report flow for real-project trials.

Success criteria:

- A report can aggregate audit summary, init dry-run, team distribution status/update preview, and maintenance inspection.
- The target repository is not initialized automatically.
- The target repository root files are not overwritten.
- Report generation is deterministic enough to test.
- sample can be used as a real target smoke test.

Constraints:

- Keep `commands` conservative; candidate commands remain unconfirmed.
- Do not run project tests in the target repository.
- Do not invoke live subagents, external marketplaces, or dynamic workflows.
- No automatic writes to existing target project files.

Verification:

- Add failing tests first.
- Run targeted tests.
- Run `npm test`.
- Smoke test against `D:\code_space\trae-project\sample`.


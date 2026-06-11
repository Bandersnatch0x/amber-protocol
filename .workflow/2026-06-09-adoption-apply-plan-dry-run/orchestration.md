# Adoption Apply-Plan Dry-Run Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-tests`
   - Add RED tests for `adoption apply-plan --dry-run`.
   - Verify missing `--dry-run` is rejected.

2. `packet-b-implementation`
   - Implement core helper and CLI route.
   - Reuse scaffold dry-run preview.
   - Preserve no-overwrite behavior.

3. `packet-c-sample-docs`
   - Generate sample apply-plan example.
   - Update README and examples docs.

4. `packet-d-verification`
   - Run CLI tests, full tests, manifests, workflow verification, and boundary checks.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before non-dry-run apply behavior.
- Stop before writing to `D:\code_space\trae-project\sample`.
- Stop before running sample commands.
- Stop before real subagent or Dynamic Workflow execution.


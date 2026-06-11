# Adoption Selected-Files Proposal Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-tests`
   - Add RED tests for valid and invalid `adoption selected-files`.

2. `packet-b-implementation`
   - Implement repeatable `--include` parsing.
   - Implement selected-files proposal writer.

3. `packet-c-sample-docs`
   - Generate a sample selected-files example.
   - Update README and examples docs.

4. `packet-d-verification`
   - Run CLI tests, full tests, manifests, workflow verification, and boundary checks.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\sample`.
- Stop before running sample commands.
- Stop before real subagent or Dynamic Workflow execution.


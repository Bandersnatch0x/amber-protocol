# Adoption Integration Readiness Review Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-diff-inventory`
   - Inventory changed adoption files and generated examples.

2. `packet-b-spec-boundary-review`
   - Review implementation and docs for V1 boundary violations.

3. `packet-c-quality-review`
   - Review changed code and tests for maintainability issues.

4. `packet-d-verification`
   - Run full verification and sample boundary check.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\sample`.
- Stop before running sample commands.
- Stop before real subagent or Dynamic Workflow execution.


# Adoption Commit Readiness Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-change-inventory`
   - Inventory tracked and untracked changes.

2. `packet-b-commit-grouping`
   - Produce coherent commit candidate groups.

3. `packet-c-boundary-review`
   - Review groups for V1 boundary and sample safety.

4. `packet-d-verification`
   - Run verification and close the workflow.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\sample`.
- Stop before running sample commands.
- Stop before real subagent or Dynamic Workflow execution.
- Stop before git staging or committing.


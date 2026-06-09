# Adoption Pre-Stage Diff Review Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-implementation-review`
   - Review changed implementation and tests for defects.

2. `packet-b-docs-artifacts-review`
   - Review README, examples README, and generated StockAgents artifacts.

3. `packet-c-boundary-review`
   - Review V1 safety boundaries and target isolation.

4. `packet-d-verification`
   - Run full verification and close the workflow.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\StockAgents`.
- Stop before running StockAgents commands.
- Stop before real subagent or Dynamic Workflow execution.
- Stop before git staging or committing.


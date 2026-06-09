# Adoption Decision-Record Command Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-tests`
   - Add RED CLI test for `adoption decision-record`.
   - Verify failure before implementation.

2. `packet-b-implementation`
   - Implement core helper and CLI route.
   - Preserve no-overwrite and V1 boundaries.

3. `packet-c-stockagents-docs`
   - Generate a StockAgents decision-record example.
   - Update README and examples docs.

4. `packet-d-verification`
   - Run targeted tests, full tests, manifests, workflow verification, and boundary checks.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\StockAgents`.
- Stop before running StockAgents tests, lint, build, Python modules, or package scripts.
- Stop before real subagent or Dynamic Workflow execution.


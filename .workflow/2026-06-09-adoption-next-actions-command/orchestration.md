# Adoption Next-Actions Command Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-tests`
   - Add RED CLI test for `adoption next-actions`.
   - Verify it fails for the expected missing command.

2. `packet-b-implementation`
   - Implement core helper and CLI route.
   - Reuse existing adoption bundle artifacts.
   - Preserve no-overwrite and V1 boundaries.

3. `packet-c-stockagents-docs`
   - Generate a StockAgents CLI-produced next-actions artifact.
   - Update README and examples documentation.

4. `packet-d-verification`
   - Run targeted tests, full tests, manifest validation, workflow verification, and boundary checks.

## Review Rule

Each packet produces:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\StockAgents`.
- Stop before running StockAgents tests, lint, build, or Python modules.
- Stop before real subagent or Dynamic Workflow execution.


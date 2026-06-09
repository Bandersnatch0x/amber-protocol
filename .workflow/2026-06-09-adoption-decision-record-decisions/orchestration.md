# Adoption Decision-Record Decisions Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-tests`
   - Add RED tests for valid and invalid `--decision` values.
   - Verify failures before implementation.

2. `packet-b-implementation`
   - Implement repeatable `--decision` parsing.
   - Render decisions and notes into JSON and markdown.
   - Preserve no-overwrite behavior.

3. `packet-c-stockagents-docs`
   - Generate a StockAgents example with explicit pending/deferred decisions.
   - Update docs.

4. `packet-d-verification`
   - Run CLI tests, full tests, manifests, workflow verification, and boundary checks.

## Review Rule

Each packet requires:

- implementer result
- spec review
- quality review

## Hard Stops

- Stop before writing to `D:\code_space\trae-project\StockAgents`.
- Stop before running StockAgents commands.
- Stop before real subagent or Dynamic Workflow execution.


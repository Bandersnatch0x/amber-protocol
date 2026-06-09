# StockAgents Gate Resolution Orchestration

Mode: simulated subagent-driven-development

## Packets

1. `packet-a-findings`
   - Extract gate decision, findings, metrics, manifest boundary claims, candidate command, unknowns, and dry-run missing files.
   - Output implementer, spec review, and quality review records.

2. `packet-b-next-actions`
   - Write the read-only next-actions document.
   - Separate required Harness files from optional starter wiki files.
   - Keep all target-changing commands behind human approval.
   - Output implementer, spec review, and quality review records.

3. `packet-c-verification`
   - Verify the document and workflow artifacts.
   - Re-check StockAgents boundary evidence.
   - Output implementer, spec review, and quality review records.

## Review Rule

Each packet is considered complete only after:

- implementation result is recorded
- spec review approves V1 boundary and packet scope
- quality review approves clarity and maintainability

## Hard Stops

- Stop before any command that writes to `D:\code_space\trae-project\StockAgents`.
- Stop before any command that runs StockAgents tests, builds, lint, package scripts, or Python modules.
- Stop before any real subagent or Dynamic Workflow execution.


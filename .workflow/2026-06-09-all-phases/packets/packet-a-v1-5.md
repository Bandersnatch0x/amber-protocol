# Packet A: V1.5 Compatibility And Doctor Hardening

## Objective

Implement V1.5 gates from `ROADMAP.md`.

## Scope

- Codex and Claude manifest validation remains local and read-only.
- `doctor --target .` reports product-repo status for this toolkit.
- Target classification distinguishes product repo, harnessed target repo, and unharnessed target repo.
- Minimal workflow-pack/profile smoke validation inspects declarations without executing scripts or workflows.

## Do Not

- Execute workflow packs.
- Dispatch workers.
- Rewrite target project files.

## Verification

- Targeted tests for classification and pack/profile smoke validation.
- `npm test`


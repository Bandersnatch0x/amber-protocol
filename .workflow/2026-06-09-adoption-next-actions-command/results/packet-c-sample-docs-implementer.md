# Packet C sample And Docs Result

Status: DONE

## Scope

- Generated `docs/examples/sample-adoption-next-actions-cli.md` with the new CLI.
- Updated `README.md`.
- Updated `docs/examples/README.md`.

## Command

```sh
node scripts/harness.js adoption next-actions --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-next-actions-cli.md --json
```

## Result

- target: `D:\code_space\trae-project\sample`
- gate decision: `wait`
- errors: 0
- candidate commands: 1
- unknowns: 3
- approval gates: 3

## Boundary Check

- `AGENTS.md=false`
- `CLAUDE.md=false`
- `feature_list.json=false`
- `PROGRESS.md=false`
- `session-handoff.md=false`
- `clean-state-checklist.md=false`
- `evaluator-rubric.md=false`


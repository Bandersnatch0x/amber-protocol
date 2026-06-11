# Packet C sample And Docs Result

Status: DONE

## Scope

- Generated `docs/examples/sample-adoption-apply-plan.md`.
- Updated `README.md`.
- Updated `docs/examples/README.md`.

## Command

```sh
node scripts/harness.js adoption apply-plan --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-apply-plan.md --dry-run --json
```

## Result

- target: `D:\code_space\trae-project\sample`
- dry-run: true
- apply ready: false
- created preview: 30
- skipped existing: 0
- errors: 0

## Boundary Check

- `AGENTS.md=false`
- `CLAUDE.md=false`
- `feature_list.json=false`
- `PROGRESS.md=false`
- `session-handoff.md=false`
- `clean-state-checklist.md=false`
- `evaluator-rubric.md=false`


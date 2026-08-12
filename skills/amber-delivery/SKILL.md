---
name: amber-delivery
description: Govern a change from objective and plan through session evidence, approval, handoff, and acceptance.
x-amber-json: {"kind":"journey","command":"node scripts/amber.js next --objective {{objective}} --target {{target}}","commandName":"delivery","args":[{"name":"objective","hint":"delivery objective"},{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-delivery"}
---

# Governed Delivery

Use one lifecycle. Do not skip a gate because implementation already exists.

1. Read `AGENTS.md`, the operating manual, feature state, current plan, and active session state. Preserve pre-existing dirty files.
2. Run `amber next --objective "<objective>" --target <repo>`. Treat the route suggestion as deterministic advice, not authorization.
3. Ensure the feature and vertical-slice plan exist. Run `amber gate --plan <plan>`; use `--confirm` only after explicit user approval.
4. Start or continue one governed session. For an Action-equivalent write such as `session start`, first inspect the `approvalRequired` response, then re-run with `--confirm` only after the required approval. Bind the chosen route explicitly when ambiguity remains.
5. Implement only the confirmed slice. Mutating project commands still require the route's approval and isolation rules; this skill never supplies a bypass.
6. Record real verification with `session verify --execute --confirm` when policy permits. A claim-only verification is not equivalent evidence.
7. Run `session complete-check`, resolve required approval gates with `session approve`, then complete the session only when evidence passes.
8. Run plan review and gate again, prepare `handoff`, and use `accept` only after review findings are closed.

Evidence order: confirmed plan, route/session identity, changed-file scope, command exit evidence, ledger/timeline records, review findings, approval decision, handoff/acceptance record.

On failure, stop at the failing stage. Keep the session resumable, record the real negative evidence, update the plan Resume Checkpoint, and do not mark later stages complete. Corrupt or missing governance state is a blocker, never an empty state.

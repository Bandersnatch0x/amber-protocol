# F084 delivery and acceptance

Date: 2026-11-06

F084 gives repository maintainers checked plan slice declarations and one context freshness policy shared by inspection, refresh, and loading. The implementation was delivered by [PR #391](https://github.com/Bandersnatch0x/amber-protocol/pull/391) and accepted through `amber accept` after independent reviews and default-branch delivery were verified.

## Delivery evidence

- Reviewed head: `28fc2051c30750878085a765edb1b49443956e6c`.
- Review base: `b400683c5243442852cbc3cefef3e65d6175f6fa`.
- Merge commit: `ef0519a9acaf5470b14089bf2bc05a6a94aef488`.
- Destination: `Bandersnatch0x/amber-protocol`, branch `master`.
- GitHub returned `MERGED`. `git merge-base --is-ancestor ef0519a9acaf5470b14089bf2bc05a6a94aef488 origin/master` exited 0, and `git diff 28fc2051c30750878085a765edb1b49443956e6c ef0519a9acaf5470b14089bf2bc05a6a94aef488` was empty.
- All 42 reviewed file hashes matched the committed head. Stable patch ID against the review base was `1dd1079c91cbda9dca478f3fd6ac6d762966c8f2`.

The repository's documented single-maintainer convention was used only after CI passed. The merge request bound the reviewed head with `--match-head-commit`; branch protection was not changed.

## Independent review

Claude Code implemented the changes through Orca orchestration. Separate Codex workers reviewed Standards and Spec and then checked each repair in successive bounded closure reviews. Neither reviewer edited the implementation.

| Axis | Final result | Evidence and disposition |
| --- | --- | --- |
| Standards | PASS | Original path-tokenization and misleading-comment findings closed. The final reviewer independently checked 11 dependency cases and confirmed that the last source change contained only the declared empty-token repair. |
| Spec | PASS+NOTES | All F084 blocking findings closed. The final reviewer independently reran eight gate and CLI probe groups with zero failures, preserving the earlier Context compliance review. |

The review covered literal slice headers, misplaced metadata, normalized subsystem counts, Windows drive paths, empty dependency declarations, safe page-ID indexes, same-instant feedback ordering, refresh expiry provenance, and assurance metadata in every Loadout tier. Real gate and CLI counterexamples drove the repairs. Fix-then-revert checks made the relevant regression assertions fail before restoring each fix.

Raw reports and probes are local, unversioned artifacts under `.scratch/pstack-f084-pickup/` and `.scratch/pstack-f084-claude/`. This document promotes their conclusions and provenance; a fresh clone does not need those local paths to understand the delivery result. Local work-ticket Logs for 0201 and 0202 retain the same conclusions.

## Verification

The final implementation ran `npm test` with 4258 tests passed, 0 failed, 0 cancelled, 0 skipped, and a shell-recorded exit code of 0. Manifests, doctor, wiki validation, generated-agent and CLI-documentation checks, lint, formatting, and the F084 plan gate passed. CLI probes verified expiry, append-only feedback, unchanged stored page bytes, refresh requests, and malformed plan refusals.

[CI run 42084713619](https://github.com/Bandersnatch0x/amber-protocol/actions/runs/42084713619) passed Node 20.x, Node 22.x, Coverage, Security, Performance, Web viewer, both public-documentation jobs, and commit identity. [The fresh-target governance run](https://github.com/Bandersnatch0x/amber-protocol/actions/runs/42084713863) also passed. Release dry-run and npm publication were not applicable to this PR. No package release was requested or performed.

The acceptance record and plan checkpoint are bookkeeping changes after the tested implementation. They do not change runtime code. Their own manifest, doctor, wiki, plan, and formatting checks are required before publication.

## Retained boundaries

1. The pre-existing benchmark schema does not accept the `expired` exclusion reason, even though the baseline Loadout already emitted it. F084's new assurance field is benchmark-consumable; this does not claim compatibility for every expired-page fixture. Exact golden fixtures made before assurance metadata may need updating.
2. `doctor` reports `timeStale` as a freshness count. TTL expiry is not a new hard-failure or admission rule. Feedback confidence remains advisory, and contradicted pages are not automatically excluded.
3. `amber accept` created a local memory nomination. It is a nomination only, not an approved memory entry. Durable F084 knowledge is already captured in the two canonical specs and ADR-0109; no MEMORY.md content was automatically written or approved.

Learning review is booked to owner `script`, with `docs/specs/plan-slice-contract.md` and `docs/specs/context-freshness-loop.md` as the reviewed surfaces. The deterministic parser and freshness policy carry the prevention behavior.

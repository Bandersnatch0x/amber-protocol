# F093: Completed Session guidance

spec_id: F093
**Status:** accepted
owner: repository-maintainer
feature: F093
provenance: 2026-11-28 real-repository F092 trial; user requested proceeding with the recommendation.

## Contract

1. A completed Session whose strict completion check passes has no `session-complete` next action. Its workbench explicitly says the Session is already completed and needs no further closing command, in English and Chinese.
2. An unfinished Session whose strict check passes retains the existing closing command. Other Session states retain their existing behavior.
3. A failed completion check retains every missing item and remediation action, including on a completed Session. The next-action projection keeps the strict check result separate from Session lifecycle; a completed manifest never promotes a failed check to pass.
4. Missing or corrupt manifests remain visible failures. Next-action queries and rendering do not write repository files, execute suggested remediation commands, or mutate Session history.
5. CLI completion semantics, approval, acceptance, stage projection, verification controls, and scheduling are outside this change.

## Acceptance evidence

Adapter regression tests cover completed/pass, executing/pass, completed/fail, and missing/corrupt manifests with read-only assertions. Component tests verify both languages, the absence of repeated commands, and retained missing-evidence guidance. Browser verification uses the existing real F092 Session without changing its files. Test removal of the fix must reproduce the failure.

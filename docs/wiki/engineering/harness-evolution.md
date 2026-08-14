# Amber Evolution Log

Last Reviewed: 2026-08-13

## 2026-07-14 docs/plans/F009-Governance-evidence-reads-resolve-state-dir-legacy-harness-support.md

- Plan: `docs/plans/F009-Governance-evidence-reads-resolve-state-dir-legacy-harness-support.md`
- Review status: ready
- Feature: F009 status → accepted in feature_list.json

## 2026-07-22 docs/plans/F010-Ship-1-3-8-after-interrupted-1-3-7-release.md

- Plan: `docs/plans/F010-Ship-1-3-8-after-interrupted-1-3-7-release.md`
- Review status: ready
- Feature: F010 status → accepted in feature_list.json

## 2026-07-28 docs/plans/F011-Fill-missing-CLI-REFERENCE-command-sections.md

- Plan: `docs/plans/F011-Fill-missing-CLI-REFERENCE-command-sections.md`
- Review status: ready
- Feature: F011 status → accepted in feature_list.json

## 2026-07-31 docs/plans/F012-Pre-push-hook-rejects-pi-rewind-checkpoint-refs.md

- Plan: `docs/plans/F012-Pre-push-hook-rejects-pi-rewind-checkpoint-refs.md`
- Review status: ready
- Feature: F012 status → accepted in feature_list.json

## 2026-08-04 F013 — Knowledge Plan deep seal (read + write facade)

- Commit: `5adbc0a..b7cef47` (F013-K1 read inspect/report/validate, K2 write scaffold/build/plan, K3 import firewall + legacy compat contract)
- Surface: root facade `scripts/lib/knowledge-plan`, command adapter, `internal/` seam; legacy `core/knowledge-plan.js` forwards hooks for one major-release deprecation cycle.
- Verification: knowledge-plan suites 58/58 pass; full `npm test` 1407/1407.
- Status: completed (reviewed clean). Tracked via commits — no standalone `docs/plans/` file.

## 2026-08-04 F014 — Maintenance facade seal (evidence + command adapter)

- Commit: `937bd70..cb83532` (M1 evidence facade, M2 partial-state propagation, M3 command adapter, M4 seal + deprecation contract)
- Surface: root facade `scripts/lib/maintenance` (evidence/inspect/staleDocs), Governance Console command adapter; legacy `core/maintenance.js` marked forwarding compat adapter, removal deferred to declared major release.
- Verification: maintenance suites 38/38 pass; full `npm test` 1407/1407.
- Status: completed (reviewed clean). Tracked via commits — no standalone `docs/plans/` file.

## 2026-08-04 docs/plans/F015-Loop-no-progress-reporting.md

- Plan: `docs/plans/F015-Loop-no-progress-reporting.md`
- Review status: ready
- Feature: F015 status → accepted in feature_list.json

## 2026-08-10 docs/plans/F016-Review-blocker-remediation.md

- Plan: `docs/plans/F016-Review-blocker-remediation.md`
- Review status: ready
- Feature: F016 status → accepted in feature_list.json

## 2026-08-12 docs/plans/F018-Amber-MCP.md

- Plan: `docs/plans/F018-Amber-MCP.md`
- Review status: ready
- Feature: F018 status → accepted in feature_list.json

## 2026-08-13 docs/plans/F019-Intent-router-deep-journey-skills-default-help-projection.md

- Plan: `docs/plans/F019-Intent-router-deep-journey-skills-default-help-projection.md`
- Review status: ready
- Feature: F019 status → accepted in feature_list.json

## 2026-08-14 docs/plans/F020-Remediate-v1-5-1-review-findings.md

- Plan: `docs/plans/F020-Remediate-v1-5-1-review-findings.md`
- Review status: ready
- Feature: F020 status → accepted in feature_list.json

## 2026-08-14 docs/plans/F021-Align-prerelease-publish-policy.md

- Plan: `docs/plans/F021-Align-prerelease-publish-policy.md`
- Review status: ready
- Feature: F021 status → accepted in feature_list.json

## 2026-08-14 docs/plans/F022-Per-turn-workflow-state-breadcrumb-hook.md

- Plan: `docs/plans/F022-Per-turn-workflow-state-breadcrumb-hook.md`
- Review status: ready
- Feature: F022 status → accepted in feature_list.json

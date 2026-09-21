# Historical Provenance Recovery: F013 & F014 (GitHub Issues #76–#84)

**Generated Date:** 2026-09-01  
**Scope Gate / Repository:** `D:/code_space/.orca-workspaces/coding-harness/f013-f014-recovery-2026-09-01`  
**Target Scope:** GitHub Issues [#76](https://github.com/Bandersnatch0x/amber-protocol/issues/76), [#77](https://github.com/Bandersnatch0x/amber-protocol/issues/77), [#78](https://github.com/Bandersnatch0x/amber-protocol/issues/78), [#79](https://github.com/Bandersnatch0x/amber-protocol/issues/79), [#80](https://github.com/Bandersnatch0x/amber-protocol/issues/80), [#81](https://github.com/Bandersnatch0x/amber-protocol/issues/81), [#82](https://github.com/Bandersnatch0x/amber-protocol/issues/82), [#83](https://github.com/Bandersnatch0x/amber-protocol/issues/83), [#84](https://github.com/Bandersnatch0x/amber-protocol/issues/84)  
**Investigation Mode:** Read-only historical provenance analysis without modification of source code, specs, ADRs, or registry files.

---

## 1. Executive Summary & Verdict

This historical provenance investigation was conducted to determine the canonical local disposition of GitHub issues **#76–#84** without speculating or guessing that they belong to subsequent features **F015** or **F016**.

### Primary Findings:
1. **Definitive Feature Mapping:**
   - **F013 ("Deepen Knowledge Plan module behind stable facade")** is tracked by parent epic **#76** and sub-issues **#79 (K1)**, **#80 (K2)**, and **#83 (K3)**.
   - **F014 ("Deepen Maintenance evidence seam with partial-state reporting")** is tracked by parent epic **#77** and sub-issues **#78 (M1)**, **#81 (M2)**, **#82 (M3)**, and **#84 (M4)**.
2. **Implementation Status:**
   - All 9 issues are **CLOSED** on GitHub with verified test runs.
   - All corresponding code was implemented and landed directly on the `master` branch across 7 discrete git commits:
     - F013: `5adbc0a` (K1), `c96084a` (K2), `b7cef47` (K3)
     - F014: `937bd70` (M1), `2fafd57` (M2), `f6f6363` (M3), `cb83532` (M4)
   - The shipped modules (`scripts/lib/knowledge-plan/`, `scripts/lib/maintenance/`) and unit test suites (`tests/unit/knowledge-plan-*.test.js`, `tests/unit/maintenance-*.test.js`) are **active, green, and intact at HEAD**.
3. **Repository Evolution & Registry State:**
   - In commit `ef99f3d` (`docs(evolution): log F013 knowledge-plan and F014 maintenance facade completion`), the maintainer explicitly registered both F013 and F014 in [`docs/wiki/engineering/harness-evolution.md`](../wiki/engineering/harness-evolution.md) as completed iterations tracked via commits without standalone `docs/plans/` files.
   - F013 and F014 were **merely omitted** from [`feature_list.json`](../../feature_list.json). They were never renamed, superseded, or abandoned.
4. **F015 / F016 Independence:**
   - F013/F014 are completely separate from **F015** ("Loop no-progress reporting", ADR-0013) and **F016** ("Review blocker remediation", ADR-0015). Any hypothesis that issues #76–#84 belong to or are duplicated by F015/F016 is an **unsupported inference** contradicted by all code and documentation evidence.
5. **Canonical Disposition:**
   - All 9 issues receive the canonical disposition **`historical-provenance`** with an **`omitted-from-feature-list`** registry status.

---

## 2. Master Summary Table: GitHub Issues #76–#84

| Issue # | Title | Role / Parent | Landed Commits | Shipped Evidence at HEAD | Confidence | Contradictions / Gaps | Canonical Disposition | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **#76** | F013: Deepen Knowledge Plan module behind stable facade | Parent Epic (F013) | `5adbc0a`<br>`c96084a`<br>`b7cef47` | `scripts/lib/knowledge-plan/`<br>`tests/unit/knowledge-plan-*.test.js`<br>`docs/wiki/engineering/harness-evolution.md` | High | Omitted from `feature_list.json`; no standalone plan file in `docs/plans/`. | `historical-provenance` | Retain as historical provenance for F013. If backfilling `feature_list.json`, add F013 as accepted. |
| **#77** | F014: Deepen Maintenance evidence seam with partial-state reporting | Parent Epic (F014) | `937bd70`<br>`2fafd57`<br>`f6f6363`<br>`cb83532` | `scripts/lib/maintenance/`<br>`tests/unit/maintenance-*.test.js`<br>`docs/wiki/engineering/harness-evolution.md` | High | Omitted from `feature_list.json`; no standalone plan file in `docs/plans/`. | `historical-provenance` | Retain as historical provenance for F014. If backfilling `feature_list.json`, add F014 as accepted. |
| **#78** | F014-M1: Expose honest Maintenance evidence outcome | Sub-task (Parent: #77) | `937bd70` | `scripts/lib/maintenance/internal/evidence.js`<br>`tests/unit/maintenance-evidence-facade.test.js`<br>`tests/unit/workflow-assessment.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F014 Step M1. |
| **#79** | F013-K1: Deepen read-only Knowledge Plan flows | Sub-task (Parent: #76) | `5adbc0a` | `scripts/lib/knowledge-plan/internal/{load,validate,report}.js`<br>`tests/unit/knowledge-plan-facade.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F013 Step K1. |
| **#80** | F013-K2: Deepen write-capable Knowledge Plan flows | Sub-task (Parent: #76) | `c96084a` | `scripts/lib/knowledge-plan/internal/{scaffold,build,propose}.js`<br>`tests/unit/knowledge-plan-command-adapter.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F013 Step K2. |
| **#81** | F014-M2: Propagate Maintenance partial state to Governance and Adoption | Sub-task (Parent: #77) | `2fafd57` | `scripts/lib/core/evolution-findings.js`<br>`tests/unit/maintenance-partial-propagation.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F014 Step M2. |
| **#82** | F014-M3: Route every Maintenance command through one adapter | Sub-task (Parent: #77) | `f6f6363` | `scripts/lib/maintenance/adapters/command.js`<br>`tests/unit/maintenance-command-adapter.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F014 Step M3. |
| **#83** | F013-K3: Seal Knowledge Plan interface and deprecation contract | Sub-task (Parent: #76) | `b7cef47` | `tests/unit/knowledge-plan-interface.test.js`<br>`tests/unit/knowledge-plan-compat.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F013 Step K3. |
| **#84** | F014-M4: Seal Maintenance interface and deprecation contract | Sub-task (Parent: #77) | `cb83532` | `tests/unit/maintenance-interface.test.js`<br>`tests/unit/maintenance-compat.test.js`<br>`tests/unit/maintenance-dispatch.test.js` | High | None. | `historical-provenance` | Retain as historical provenance for F014 Step M4. |

---

## 3. Answers to Core Provenance Questions

### Question 1: What did each of #76–#84 actually propose or implement?

- **#76 (F013 Epic):** Proposed refactoring Knowledge Plan into a deep module structure behind a root facade (`scripts/lib/knowledge-plan/index.js`) exposing six explicit use cases (`inspect`, `report`, `validate`, `scaffold`, `build`, `plan`) and a dedicated Governance Console command adapter (`scripts/lib/knowledge-plan/adapters/command.js`). It encapsulated loading, validation, YAML parsing, report formatting, page materialization, and proposal inspection behind an internal seam (`scripts/lib/knowledge-plan/internal/`), while retaining `scripts/lib/core/knowledge-plan.js` as a forwarding compatibility adapter with a major-release deprecation policy.
- **#77 (F014 Epic):** Proposed deepening Maintenance behind two read-only facade outcomes (full inspection `inspectMaintenance` and focused evidence `inspectMaintenanceEvidence`) and a single command adapter (`scripts/lib/maintenance/adapters/command.js`) handling all 10 subcommands. It established honest non-blocking partial-state reporting: corrupt evidence records are skipped with redacted warnings rather than silently discarded or converted into fatal errors.
- **#78 (F014-M1):** Implemented the focused Maintenance evidence facade (`scripts/lib/maintenance/internal/evidence.js`) and updated `Workflow Effectiveness` (`workflow-assessment.js`) to consume it directly without depending on Team Distribution registry availability. Corrupt/unreadable records produce partial completeness and redacted warnings. (Landed in `937bd70`).
- **#79 (F013-K1):** Implemented the read-only Knowledge Plan deepening for `inspect`, `report`, and `validate` use cases through the root facade and command adapter. (Landed in `5adbc0a`).
- **#80 (F013-K2):** Implemented the write-capable Knowledge Plan deepening for default scaffold, explicit `scaffold`, `build`/`materialize`, and `plan` through the root facade and command adapter. (Landed in `c96084a`).
- **#81 (F014-M2):** Implemented propagation of Maintenance partial evidence to `amber governance report` and `amber adoption` by having `inspectMaintenance` compose `inspectMaintenanceEvidence`. Extracted evolution collectors to `scripts/lib/core/evolution-findings.js` to avoid circular requires. (Landed in `2fafd57`).
- **#82 (F014-M3):** Implemented the unified Maintenance command adapter handling all 10 subcommands, moving `scaffold-drift` and `distill` into the adapter and removing subcommand knowledge from outer dispatcher handlers. (Landed in `f6f6363`).
- **#83 (F013-K3):** Implemented Knowledge Plan interface sealing with an import firewall (`tests/unit/knowledge-plan-interface.test.js`) and legacy CommonJS forwarding compatibility contract (`tests/unit/knowledge-plan-compat.test.js`). (Landed in `b7cef47`).
- **#84 (F014-M4):** Implemented Maintenance interface sealing with an import firewall (`tests/unit/maintenance-interface.test.js`), legacy CommonJS forwarding compatibility contract (`tests/unit/maintenance-compat.test.js`), and caller migration (`governance-report.js`, `adoption-reports.js`, `wiki-drift.js`), eliminating monkey-patching in tests. (Landed in `cb83532`).

---

### Question 2: Is there a local spec, ADR, feature registry entry, plan, or shipped code that is a direct canonical target?

1. **Shipped Code & Tests (Direct Canonical Target):**
   - **YES.** Full production implementation and tests for F013 and F014 are shipped, active, and green at HEAD:
     - F013 production code: `scripts/lib/knowledge-plan/index.js`, `scripts/lib/knowledge-plan/adapters/command.js`, `scripts/lib/knowledge-plan/adapters/renderers.js`, `scripts/lib/knowledge-plan/internal/*.js`, `scripts/lib/core/knowledge-plan.js`, `scripts/lib/command-dispatcher.js`.
     - F013 tests: `tests/unit/knowledge-plan-facade.test.js`, `tests/unit/knowledge-plan-command-adapter.test.js`, `tests/unit/knowledge-plan-compat.test.js`, `tests/unit/knowledge-plan-interface.test.js`.
     - F014 production code: `scripts/lib/maintenance/index.js`, `scripts/lib/maintenance/adapters/command.js`, `scripts/lib/maintenance/internal/evidence.js`, `scripts/lib/maintenance/internal/repository-evidence.js`, `scripts/lib/core/evolution-findings.js`, `scripts/lib/core/maintenance.js`, `scripts/lib/core/adoption-reports.js`, `scripts/lib/core/governance-report.js`, `scripts/lib/core/wiki-drift.js`.
     - F014 tests: `tests/unit/maintenance-evidence-facade.test.js`, `tests/unit/workflow-assessment.test.js`, `tests/unit/maintenance-partial-propagation.test.js`, `tests/unit/maintenance-command-adapter.test.js`, `tests/unit/maintenance-compat.test.js`, `tests/unit/maintenance-dispatch.test.js`, `tests/unit/maintenance-interface.test.js`.
2. **Canonical Evolution Record:**
    - **YES.** [`docs/wiki/engineering/harness-evolution.md`](../wiki/engineering/harness-evolution.md) explicitly contains:
     - `## 2026-08-04 F013 — Knowledge Plan deep seal (read + write facade)`
     - `## 2026-08-04 F014 — Maintenance facade seal (evidence + command adapter)`
3. **Local Spec / ADR / Plan / Feature List:**
   - **Specs (`docs/specs/`):** None created specifically for F013/F014.
   - **ADRs (`docs/adr/`):** None created specifically for F013/F014 (ADR-0008 covers earlier concept of workflow effectiveness vs governance readiness; ADR-0013 is F015, ADR-0014 is routing advisor, ADR-0015 is F016, ADR-0016 is F019/F020).
   - **Plans (`docs/plans/`):** None authored at inception; `harness-evolution.md` explicitly notes: *"Status: completed (reviewed clean). Tracked via commits — no standalone docs/plans/ file."*
   - **Feature Registry (`feature_list.json`):** F013 and F014 are **omitted** from `feature_list.json`.

---

### Question 3: Were F013/F014 renamed, superseded, abandoned, or merely omitted from feature_list.json?

- **Conclusion: Merely Omitted.**
- **Evidence:**
  - Neither feature was renamed (the commit messages, file paths, and evolution logs use `F013` and `F014` consistently).
  - Neither feature was superseded (the facades, internal modules, command adapters, and tests implemented by F013 and F014 remain the active production architecture at HEAD).
  - Neither feature was abandoned (all 7 commits landed on master, all tests pass with 1407/1407 clean, and all 9 GitHub issues were formally closed as verified).
  - In commit `ef99f3d` (`docs(evolution): log F013 knowledge-plan and F014 maintenance facade completion`), the maintainer explicitly noted that F013 and F014 had landed via commits without separate plan files or initial evolution entries, and formally recorded their completion. The only remaining administrative gap was that entries were not added to `feature_list.json`.

---

### Question 4: Are the issue outcomes duplicated by F015/F016, or is that an unsupported inference?

- **Conclusion: Unsupported Inference.**
- **Detailed Boundary Contrast:**
  - **F013:** Deepens `Knowledge Plan` (`wiki knowledge` subcommands: inspect, report, validate, scaffold, build, plan; AJV validation; YAML/JSON plan loading).
  - **F014:** Deepens `Maintenance` (`amber maintenance` subcommands; evidence facade for Workflow Effectiveness; partial-state non-blocking warnings for Governance/Adoption reports).
  - **F015:** Defined in `docs/plans/F015-Loop-no-progress-reporting.md` and ADR-0013. Its scope is strictly bounded no-progress detection for loop ledgers (`assessLoopProgress` and `inspectLoopLedger` directory loading).
  - **F016:** Defined in `docs/plans/F016-Review-blocker-remediation.md` and ADR-0015. Its scope is fail-closed security/path boundaries on Context/Loadout, confidence gating before `spawnSync`, handoff-layout extraction, and migration error fixes.
- **Verdict:** There is zero architectural, behavioral, or file-level overlap between #76–#84 and F015/F016. Any suggestion that #76–#84 belong to F015 or F016 is contradicted by git history and code evidence.

---

### Question 5: What exact evidence supports a disposition: canonical-local-spec, canonical-local-ADR, historical-provenance, unresolved, or a new local archival record?

- **Evidence Base:**
  1. 9 Closed GitHub issues (#76–#84) with exact acceptance criteria and verify comments.
  2. 7 Concrete git commits on master (`5adbc0a`, `c96084a`, `b7cef47`, `937bd70`, `2fafd57`, `f6f6363`, `cb83532`).
  3. Active production files and test suites at HEAD.
  4. Explicit entries in `docs/wiki/engineering/harness-evolution.md`.
  5. Absence of standalone spec/ADR/plan files and absence from `feature_list.json`.
- **Verdict:**
  - The exact disposition is **`historical-provenance`** with an **`omitted-from-feature-list`** registry status.
  - No cases among #76–#84 are `unresolved` (all are verified and closed).
  - A new local archival record is established by this document (`docs/agents/f013-f014-recovery.md`) and its JSON counterpart (`docs/agents/f013-f014-recovery.json`).

---

## 4. Per-Issue Dossiers (#76 through #84)

### Issue #76: F013: Deepen Knowledge Plan module behind stable facade
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/76](https://github.com/Bandersnatch0x/amber-protocol/issues/76)
- **Role:** Parent Epic for Feature F013
- **State:** CLOSED (Closed: 2026-08-03T16:57:24Z)
- **Closing Note:** *"F013 complete: K1 (5adbc0a), K2 (c96084a), K3 (b7cef47) all landed; full suite green."*
- **Sub-tasks:** #79 (K1), #80 (K2), #83 (K3)
- **Commits:** `5adbc0a`, `c96084a`, `b7cef47`
- **Shipped Production Modules:** `scripts/lib/knowledge-plan/index.js`, `scripts/lib/knowledge-plan/adapters/command.js`, `scripts/lib/knowledge-plan/adapters/renderers.js`, `scripts/lib/knowledge-plan/internal/*.js`, `scripts/lib/core/knowledge-plan.js`, `scripts/lib/command-dispatcher.js`
- **Shipped Test Suites:** `tests/unit/knowledge-plan-facade.test.js`, `tests/unit/knowledge-plan-command-adapter.test.js`, `tests/unit/knowledge-plan-compat.test.js`, `tests/unit/knowledge-plan-interface.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Maintain canonical record as historical provenance for F013.

### Issue #77: F014: Deepen Maintenance evidence seam with partial-state reporting
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/77](https://github.com/Bandersnatch0x/amber-protocol/issues/77)
- **Role:** Parent Epic for Feature F014
- **State:** CLOSED (Closed: 2026-08-03T17:59:06Z)
- **Closing Note:** *"F014 complete: M1 (937bd70), M2 (2fafd57), M3 (f6f6363), M4 (cb83532) all landed; full suite green."*
- **Sub-tasks:** #78 (M1), #81 (M2), #82 (M3), #84 (M4)
- **Commits:** `937bd70`, `2fafd57`, `f6f6363`, `cb83532`
- **Shipped Production Modules:** `scripts/lib/maintenance/index.js`, `scripts/lib/maintenance/adapters/command.js`, `scripts/lib/maintenance/internal/evidence.js`, `scripts/lib/maintenance/internal/repository-evidence.js`, `scripts/lib/core/evolution-findings.js`, `scripts/lib/core/maintenance.js`, `scripts/lib/core/adoption-reports.js`, `scripts/lib/core/governance-report.js`, `scripts/lib/core/wiki-drift.js`
- **Shipped Test Suites:** `tests/unit/maintenance-evidence-facade.test.js`, `tests/unit/workflow-assessment.test.js`, `tests/unit/maintenance-partial-propagation.test.js`, `tests/unit/maintenance-command-adapter.test.js`, `tests/unit/maintenance-compat.test.js`, `tests/unit/maintenance-dispatch.test.js`, `tests/unit/maintenance-interface.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Maintain canonical record as historical provenance for F014.

### Issue #78: F014-M1: Expose honest Maintenance evidence outcome
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/78](https://github.com/Bandersnatch0x/amber-protocol/issues/78)
- **Role:** Sub-task (F014 Slice M1; Parent: #77)
- **State:** CLOSED (Closed: 2026-08-03T17:31:16Z)
- **Closing Note:** *"Verified: 1386 tests pass (full suite). Focused evidence facade lands as 937bd70; Workflow Effectiveness consumes it without Team Distribution dependency; corrupt records produce partial + redacted warnings. Unblocks #81 and #82."*
- **Commits:** `937bd70`
- **Shipped Code/Tests:** `scripts/lib/maintenance/internal/evidence.js`, `tests/unit/maintenance-evidence-facade.test.js`, `tests/unit/workflow-assessment.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F014-M1.

### Issue #79: F013-K1: Deepen read-only Knowledge Plan flows
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/79](https://github.com/Bandersnatch0x/amber-protocol/issues/79)
- **Role:** Sub-task (F013 Slice K1; Parent: #76)
- **State:** CLOSED (Closed: 2026-08-03T11:12:31Z)
- **Closing Note:** *"Independent verification passed via the advance-ticket workflow. Evidence summary: F013-K1 — Routed wiki knowledge inspect/report/validate through knowledge-plan facade + command adapter + internal load/validate/report; preserved operator-visible output, lookup precedence, and legacy CommonJS exports; write flows left in core for #80. verified=true"*
- **Commits:** `5adbc0a`
- **Shipped Code/Tests:** `scripts/lib/knowledge-plan/internal/{load,validate,report}.js`, `tests/unit/knowledge-plan-facade.test.js`, `tests/unit/knowledge-plan-command-adapter.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F013-K1.

### Issue #80: F013-K2: Deepen write-capable Knowledge Plan flows
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/80](https://github.com/Bandersnatch0x/amber-protocol/issues/80)
- **Role:** Sub-task (F013 Slice K2; Parent: #76)
- **State:** CLOSED (Closed: 2026-08-03T16:47:43Z)
- **Closing Note:** *"Verified: 1363 tests pass (full suite). K2 implement committed as c96084a; write-capable flows route through facade + command adapter. Unblocks #83."*
- **Commits:** `c96084a`
- **Shipped Code/Tests:** `scripts/lib/knowledge-plan/internal/{scaffold,build,propose}.js`, `scripts/lib/knowledge-plan/adapters/command.js`, `tests/unit/knowledge-plan-facade.test.js`, `tests/unit/knowledge-plan-command-adapter.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F013-K2.

### Issue #81: F014-M2: Propagate Maintenance partial state to Governance and Adoption
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/81](https://github.com/Bandersnatch0x/amber-protocol/issues/81)
- **Role:** Sub-task (F014 Slice M2; Parent: #77)
- **State:** CLOSED (Closed: 2026-08-03T17:39:30Z)
- **Closing Note:** *"Verified: 1391 tests pass (full suite). inspectMaintenance composes evidence facade; partial warnings propagate to Governance + Adoption as redacted non-blocking warnings. Committed 2fafd57. Unblocks #84."*
- **Commits:** `2fafd57`
- **Shipped Code/Tests:** `scripts/lib/core/evolution-findings.js`, `scripts/lib/core/maintenance.js`, `tests/unit/maintenance-partial-propagation.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F014-M2.

### Issue #82: F014-M3: Route every Maintenance command through one adapter
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/82](https://github.com/Bandersnatch0x/amber-protocol/issues/82)
- **Role:** Sub-task (F014 Slice M3; Parent: #77)
- **State:** CLOSED (Closed: 2026-08-03T17:50:38Z)
- **Closing Note:** *"Verified: 1399 tests pass (full suite). All ten subcommands route through scripts/lib/maintenance/adapters/command; scaffold-drift + distill moved in; aliases/envelopes/registry closure unchanged. Committed f6f6363. Unblocks #84."*
- **Commits:** `f6f6363`
- **Shipped Code/Tests:** `scripts/lib/maintenance/adapters/command.js`, `scripts/lib/command-handler-families.js`, `tests/unit/maintenance-command-adapter.test.js`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F014-M3.

### Issue #83: F013-K3: Seal Knowledge Plan interface and deprecation contract
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/83](https://github.com/Bandersnatch0x/amber-protocol/issues/83)
- **Role:** Sub-task (F013 Slice K3; Parent: #76)
- **State:** CLOSED (Closed: 2026-08-03T16:57:21Z)
- **Closing Note:** *"Verified: 1371 tests pass (full suite). Interface contract seals internal imports; legacy CommonJS surface forwards retained exports with major-release removal policy. Committed b7cef47."*
- **Commits:** `b7cef47`
- **Shipped Code/Tests:** `tests/unit/knowledge-plan-interface.test.js`, `tests/unit/knowledge-plan-compat.test.js`, `CHANGELOG.md`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F013-K3.

### Issue #84: F014-M4: Seal Maintenance interface and deprecation contract
- **URL:** [https://github.com/Bandersnatch0x/amber-protocol/issues/84](https://github.com/Bandersnatch0x/amber-protocol/issues/84)
- **Role:** Sub-task (F014 Slice M4; Parent: #77)
- **State:** CLOSED (Closed: 2026-08-03T17:59:03Z)
- **Closing Note:** *"Verified: 1407 tests pass (full suite). All consumers use root facade (inspect/evidence/staleDocs) or command adapter; monkey-patching removed; import firewall + legacy compat contracts added; legacy surface marked deprecated with major-release policy. Committed cb83532."*
- **Commits:** `cb83532`
- **Shipped Code/Tests:** `scripts/lib/core/adoption-reports.js`, `scripts/lib/core/governance-report.js`, `scripts/lib/core/wiki-drift.js`, `scripts/lib/maintenance/index.js`, `scripts/lib/core/maintenance.js`, `tests/unit/maintenance-interface.test.js`, `tests/unit/maintenance-compat.test.js`, `tests/unit/maintenance-dispatch.test.js`, `CHANGELOG.md`
- **Disposition:** `historical-provenance` (Confidence: High)
- **Recommendation:** Retain as historical provenance for F014-M4.

---

## 5. Verification & Integrity Checklist

- [x] **Exactly nine unique issues (#76–#84)** covered as primary rows.
- [x] **No other issue IDs** included as primary rows.
- [x] **Evidence URLs and commit IDs** fully cross-verified against git log and GitHub API.
- [x] **No invention or modification** of existing specs, ADRs, `feature_list.json`, migration indexes, or source code.
- [x] **Zero uncommitted writes to git or GitHub**.
- [x] **Artifacts created exclusively at requested locations:**
  - `docs/agents/f013-f014-recovery.md`
  - `docs/agents/f013-f014-recovery.json`

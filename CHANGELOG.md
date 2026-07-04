# Changelog

All notable changes to Amber Protocol will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-07-04

### Changed — Direct core imports, facade removed (#4, PR2)
- All facade consumers (`command-dispatcher`, 8 entry scripts, 12 tests) now import directly from `scripts/lib/core/*`; `grep` once again equals the dependency graph.
- Removed `scripts/lib/amber-core.js` (322-line zero-logic re-export facade) and `scripts/lib/harness-core.js` (its alias).
- New permanent guard `tests/unit/no-facade-reintroduction.test.js` prevents the facade/backdoor from returning (the old `lint` echo-shell enforced nothing).
- `templates/feature_list.json` F001 verification now points to `node scripts/amber.js doctor`.

### Removed — Zombie execution platform & experimental scope (#4, PR1)
- Five execution-platform peripheral modules (`scripts/lib/{daemon,notifier,health-checker,budget-tracker,error-recovery}.js`) and their unit tests — zero production references, kept alive only by self-tests.
- `amber daemon <status|stop>` CLI command — hidden command with no help/docs/start path; removal is bug-equivalent (minor).
- `src/experimental/execution/` and `tests/experimental/` — the cold-stored execution engine was unreachable, broken-chained (5+ dangling requires incl. `checkpoint-manager`), `test:experimental` failed 3/5, yet shipped to every installer via `files:["src/"]`. See ADR-0005.
- `test:experimental` npm script.

### Fixed
- `session start --mode autonomous` now refuses at the gate (exit 1, no manifest written), matching ADR-0002's stated intent. Previously it accepted the mode and only `session continue` refused — leaving an unreachable autonomous manifest behind.

## [1.2.0] - 2026-07-04

### Added — State-aware drift detection (`amber status` + `amber sync`)
- **`amber status`** — a curated state front-door: repo? / initialised? / fresh?, plus three drift surfaces in one glance. Read-only; does not duplicate `doctor` (validity) or `maintenance inspect` (full dump).
- **Scaffold-version drift (SP1)** — `.amber/provenance.json` (per-file sha256 + ownership tier; hash strips YAML `updated:`) and a four-class classifier (fresh / stale / customized / ambiguous / missing). `amber sync --execute` and `init --refresh-amber-owned` overwrite only `controlled + stale` files (after a `.bak` backup); `customized`/`ambiguous` controlled files are cached as proposals, never clobbered.
- **Artifact-vs-reality drift (SP2)** — optional per-feature `paths` field (`feature add --paths`) and a git-anchored `detectArtifactDrift` with six classes (drifted / aligned + skipped: no-evidence / untracked / path-unknown / anchor-invalid). Comparison is timezone-homogeneous (`Date.parse` ms); an empty pathspec is surfaced as `path-unknown` rather than swallowed into `aligned`.
- **Wiki drift (SP3)** — `detectWikiDrift` aggregates stale docs (`Last Reviewed` marker), missing required wiki pages, and controlled-wiki template drift. Surfaced in `amber status`; non-git projects are NOT skipped (wiki drift is marker/file/provenance based, not git-anchored).
- **`amber sync`** — standalone scaffold-drift resolution (dry-run by default; `--execute` applies).

### Added — Evidence-grade sessions
- **`session verify --execute`** runs the verification command in the working copy behind the policy gate and records its real exit code to the session hash-chain ledger (`verification_passed/failed/denied`).
- **`session approve`** identity gate — records who approved (interactive TTY prompt or `--yes`); the agent must not self-approve.
- **Honest `completion-check`** — `hasWorkEvidence` excludes `.amber/`/`.harness/` bookkeeping and compares the latest commit to `createdAt` at ms precision; `--strict` requires executed verification.
- Evidence ledger records now persist `stdoutTail`/`stderrTail` (passed/failed; denied omits them).
- Verification uses a dedicated `governance/verify-rules.json` allow-list (absent → built-in defaults; unparseable → stderr warn) — widening the global `rules.json` can no longer relax verification.

### Changed
- `maintenance inspect` now includes artifact drift alongside scaffold drift.
- `loadPolicyRules` now stderr-warns on an unparseable/shape-invalid `rules.json` instead of silently falling back (was a diagnostic trap).

### Fixed
- GitHub Packages publish workflow is now idempotent — a re-pointed tag or a re-run skips an already-published version instead of failing with `E409 Cannot publish over existing version`.

Baseline tests 1038 → 1136 (+98), zero regressions.

## [1.1.0] - 2026-06-30

### Added — Governed Loop Execution (GLX)
- **Governed execution of loop contract commands** via `amber loop run --execute`. A command declared in a contract's `governed` block runs behind four gates: a declarative policy check (`.amber/governance/rules.json`, deny-wins / default-deny), an explicit `amber loop approve` (one approval authorises one run), an isolated git worktree, and a tamper-evident hash-chain ledger. Default `loop run` is still dry-run; `--execute` needs an approval. (#ADR-0003)
- **Extracted reusable governed runner** (`runGovernedCommand` primitive) — the four gates are one call site, shared by loops AND route command-stages.
- **Governed route-stage execution** via `amber route test <route> --execute --stage <name>`. A route `command`-type stage's `target` can be governed-executed with the same four gates, recorded in a route-scoped ledger. Non-`command` stages refuse `--execute`.
- **Session hash-chain ledger** — `amber session verify` and `amber session approve` mirror governance-critical events (verify result, gate approval) into `.amber/sessions/<id>/ledger.jsonl` alongside the timeline. `amber session verify-ledger` detects tampering.
- **Per-context rules** — a loop contract's `governed` block and a route `command` stage may declare additional fixed-predicate rules composed with the global `rules.json`. Deny-wins is absolute: a context `allow` can never override any `deny`.
- **Declarative command policy** (`.amber/governance/rules.json`) with `governance rules init` (scaffold safe defaults), `governance rules inspect`, and `governance rules check --command "..."` (trial verdict, read-only).
- **Honest OWASP ASI coverage report** via `amber governance standards`. Each ASI01–ASI10 risk is honestly labelled `governance` / `partial` / `out-of-scope` (runtime-only risks are never falsely claimed as covered). The `present` flag reflects actual deployed controls in the target repo, not cosmetic labels.
- **Governance readiness** now inspects GLX state: missing or unsafe `rules.json` triggers a warning / block; tampered hash-chain ledgers trigger a hard block.
- **New CLI subcommands**: `loop approve` / `loop verify-ledger`, `route approve` / `route verify-ledger`, `session verify-ledger`, `governance rules <init|inspect|check>`, `governance standards`.
- New error codes: `AMBER_E_POLICY_DENY`, `AMBER_E_LOOP_NOT_APPROVED`, `AMBER_E_LEDGER_TAMPERED`.
- 27 new tests; baseline 978→1038, zero regressions.

### Changed
- Refactored README.md and README.zh-CN.md for adopter-first clarity (388→134 lines, −65%)
- Amended `README.md` / `SPEC.md` / `CLAUDE.md` non-goal sections: the blanket "no execution" is replaced by the precise ADR-0003 statement (governance-gated, human-triggered, loop/route command-stages only).
- Added `docs/adr/0003-governance-gated-execution.md` (with Phase 3 addendum for route stages).
- Approvals in hash-chain ledgers unified under the `approvalKey` / `consumedApprovalKey` field pair (was `approvalId`).

### Fixed
- Corrected `docs/README.md` path reference: `guides/getting-started.md` → `user-guide/getting-started.md`

### Added
- Banner regeneration prompt at `assets/readme/BANNER_PROMPT.md`

## [1.0.0] - 2026-06-22

### Added
- Core Amber Protocol engine (init, audit, doctor, adoption)
- Route definitions for feature/bugfix/refactor workflows
- Session lifecycle management with checkpoints and timelines
- Web viewer (beta, local-only)
- Comprehensive test suite (900+ assertions, 281 web tests)
- CI/CD pipeline with quality gates (coverage, security, performance)

### Changed
- Rebranded from Coding Harness to Amber Protocol
- Reorganized documentation by functional topics (removed phase concept)

### Documentation
- Getting started guide
- Architecture documentation (route engine, session lifecycle, governance)
- Adoption workflow for existing projects
- API reference

### Security
- Path traversal protection in session/gate readers
- Secret redaction in client error reports
- Upgraded Nodemailer to 9.0.1 to resolve GHSA-p6gq-j5cr-w38f

## [1.0.0-rc.1] - 2026-06-21

### Added
- Release candidate for community testing
- Release checklist documentation for quality assurance
- Docker isolation testing for npm package
- GPG-signed release tags
- RC validation report template

---

[Unreleased]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.0.0
[1.0.0-rc.1]: https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.0.0-rc.1

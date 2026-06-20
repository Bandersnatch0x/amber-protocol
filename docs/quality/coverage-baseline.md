# Coverage Baseline

**Generated**: 2026-06-21  
**Tool**: c8 v11.0.0  
**Command**: `npm run test:coverage`

## Overall Coverage

| Metric      | Coverage | Target | Status |
|-------------|----------|--------|--------|
| Statements  | 88.40%   | 60%    | ✅ PASS |
| Branches    | 78.92%   | 50%    | ✅ PASS |
| Functions   | 94.94%   | 55%    | ✅ PASS |
| Lines       | 88.40%   | 60%    | ✅ PASS |

## Coverage by Module

### High Coverage (≥90%)

- `scripts/lib/amber-core.js`: 100% all metrics
- `scripts/lib/harness-core.js`: 100% all metrics
- `scripts/lib/core/scaffold.js`: 100% all metrics
- `scripts/lib/core/target-classification.js`: 100% all metrics
- `scripts/lib/core/adoption-metrics.js`: 100% all metrics
- `scripts/lib/core/constants.js`: 100% all metrics
- `src/migration/dry-run.js`: 100% lines, 95.23% branches
- `src/migration/v5-to-phase-b.js`: 100% lines, 89.47% branches
- `src/security/*`: 97-100% lines across all files

### Medium Coverage (70-89%)

- `scripts/lib/command-dispatcher.js`: 82.75% lines
- `scripts/lib/distill-candidates.js`: 80.48% lines
- `scripts/lib/route-loader.js`: 86.15% lines
- `scripts/lib/core/adoption-reports.js`: 82.38% lines
- `scripts/lib/core/loops.js`: 83.33% lines
- `scripts/lib/core/maintenance.js`: 82.43% lines
- `scripts/lib/core/profiles.js`: 84.29% lines
- `src/migration/schema-validator.js`: 86.91% lines

### Low Coverage (<70%)

- `scripts/lib/daemon.js`: 52.33% lines
- `scripts/lib/governance-commands.js`: 44.55% lines
- `scripts/lib/notifier.js`: 46.80% lines
- `scripts/lib/stage-executor.js`: 51.39% lines
- `scripts/lib/core/cli-output.js`: 71.32% lines
- `scripts/lib/core/execution-validator.js`: 76.23% lines
- `scripts/run-tests.js`: 50.90% lines

## Exclusions

Per `package.json` c8 configuration:
- `tests/**` - Test files themselves
- `coverage/**` - Coverage reports
- `apps/web/**` - Web viewer (separate test suite)
- `docs/**` - Documentation
- `templates/**` - Static templates
- `scripts/compat/**` - Legacy compatibility shims

## Notes

1. **Baseline exceeds targets**: Current coverage is well above minimum thresholds set in package.json
2. **Low-coverage modules identified**: daemon.js, governance-commands.js, notifier.js, stage-executor.js need attention
3. **High security coverage**: All security modules (audit-report, dependency-scan, secret-scan) have ≥97% line coverage
4. **Migration stability**: Migration utilities have 94.29% average line coverage

## Recommendations

1. Maintain current high coverage for security and core modules
2. Prioritize improving coverage for:
   - Daemon operations (currently 52.33%)
   - Governance commands (currently 44.55%)
   - Email notifier (currently 46.80%)
   - Stage executor (currently 51.39%)
3. Current thresholds (60/50/55/60) are appropriate given baseline performance

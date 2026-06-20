# Core Use Cases for Integration Testing

## Definition

Core use cases are the fundamental operations that MUST work correctly in v1.0.0.

---

## List

### 1. amber init

**Purpose:** Create Amber structure in empty directory

**Success criteria:**
- `.amber/` directory created
- All required files present: `AGENTS.md`, `CLAUDE.md`, feature state files
- No errors or warnings
- Files are valid (parseable JSON, readable markdown)

**Failure modes:**
- Permission denied
- Disk full
- Target directory not empty (without --force)
- Invalid project structure

**Test command:**
```bash
mkdir /tmp/test-amber-init
cd /tmp/test-amber-init
amber init
```

---

### 2. amber audit

**Purpose:** Detect missing files and configuration errors

**Success criteria:**
- Returns structured report (JSON or text)
- Identifies missing required files
- Detects configuration inconsistencies
- Exit code 0 for clean projects, non-zero for issues

**Failure modes:**
- Cannot read project structure (permissions)
- Crashes on malformed JSON
- False positives on valid configurations

**Test command:**
```bash
cd /path/to/existing/project
amber audit --summary
```

---

### 3. amber doctor

**Purpose:** Verify .amber/ state consistency

**Success criteria:**
- All checks pass or provide actionable guidance
- Reports schema violations
- Detects orphaned session files
- Exit code 0 for healthy state

**Failure modes:**
- Crashes on corrupted state
- False positives on valid .amber/ directories
- Cannot recover from fixable issues

**Test command:**
```bash
cd /path/to/amber/project
amber doctor --target .
```

---

### 4. amber adoption report

**Purpose:** Generate readiness report for existing projects

**Success criteria:**
- Generates readable markdown report without crashes
- Analyzes dependencies (package.json, pom.xml, etc.)
- Assesses test coverage
- Documents missing Amber files
- Provides actionable recommendations

**Failure modes:**
- Crashes on monorepos
- Cannot parse dependency files
- Times out on large projects
- Generates corrupted markdown

**Test command:**
```bash
cd /path/to/existing/project
amber adoption report --output-dir ./adoption-report
```

---

## MEDIUM → HIGH Escalation Rules

A MEDIUM issue becomes HIGH if it:

1. **Blocks any of the 4 core use cases above**
2. **Causes data loss or state corruption**
   - Deletes .amber/ files without confirmation
   - Corrupts session state
   - Loses feature tracking data
3. **Breaks CLI basic functionality**
   - `--help` doesn't work
   - `--version` returns wrong version
   - Exit codes are inverted (success = 1, failure = 0)
4. **Security implications**
   - Writes files outside .amber/ without permission
   - Exposes secrets in logs
   - Opens security vulnerabilities

---

## Integration Test Success Criteria

For oh-my-openagent-dev project (Milestone 1):

- ✅ **CRITICAL** = 0
- ✅ **HIGH** ≤ 1 (且有明确 workaround 文档)
- ✅ **MEDIUM** 影响核心用例 → 视为 HIGH
- ✅ 所有 4 个核心用例通过

---

## Notes

- This document is the source of truth for M1 integration testing
- Update this file if core use cases change
- Reference this file in test reports and issue triage

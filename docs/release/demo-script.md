# Amber Protocol Service Package Demo Script

**Duration:** 5:30  
**Presenter:** [Name]  
**Date:** June 15, 2026

---

## 0:00-0:30 — Problem Statement

**[Screen: Title card "Amber Protocol Service Packages"]**

"AI coding tools are powerful, but they need guardrails. Today I'll show you how Amber Protocol organizes repo-local AI governance into five service packages. Each package is a documentation grouping over existing CLI commands — there are no new command namespaces, no live agent execution, and no automatic PR creation."

---

## 0:30-1:30 — Repository Onboarding

### 0:30 — Initialize Project (30s)
```bash
mkdir demo-project && cd demo-project
node scripts/amber.js init --target .
```
**[Show: Project structure with AGENTS.md, CLAUDE.md, feature_list.json, docs/wiki/]**

### 1:00 — Verify Setup (30s)
```bash
node scripts/amber.js doctor --target .
```
**[Show: Doctor report with required files and checks]**
"Onboarding confirms the repo has agent-facing rules, wiki, feature state, handoff, and verification surfaces."

---

## 1:30-2:30 — Adoption Review

### 1:30 — Generate Read-Only Report (30s)
```bash
node scripts/amber.js adoption report --target . --output-dir docs/examples/adoptions
```
**[Show: Adoption report summarizing audit, init dry-run, team, and maintenance evidence]**

### 2:00 — Gate And Bundle (30s)
```bash
node scripts/amber.js adoption gate --report docs/examples/adoptions/...
node scripts/amber.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions/index.md --output-dir docs/examples/project-adoption-bundle
```
"Adoption Review produces read-only readiness evidence before any changes are made."

---

## 2:30-3:30 — Governed Delivery

### 2:30 — Plan And Gate (30s)
```bash
node scripts/amber.js plan --target . --feature F001 --title "Small slice"
node scripts/amber.js gate --target . --plan docs/plans/F001-small-slice.md
```
**[Show: Plan file and gate report asking for user confirmation]**

### 3:00 — Review, Accept, And Completion Check (30s)
```bash
node scripts/amber.js review --target . --plan docs/plans/F001-small-slice.md
node scripts/amber.js session complete-check --target . --session <session-id>
```
"Governed Delivery moves one task through plan, gate, review, accept, and completion evidence. The gate blocks implementation-ready status until required evidence exists."

---

## 3:30-4:15 — Continuity Layer

### 3:30 — Start And Resume Work (30s)
```bash
node scripts/amber.js session start --target . --goal "fix login bug"
node scripts/amber.js session status --target .
node scripts/amber.js session continue --target .
```
**[Show: Session manifest, timeline, and continuity-surface references]**
"The Continuity Layer helps humans and agents resume work from repo-local session state, checkpoints, and continuity surfaces."

---

## 4:15-5:00 — Security Governance

### 4:15 — Security Audit (25s)
```bash
node scripts/amber.js security audit --target . --output docs/examples/security-audit.md
```
**[Show: Security audit report with dependency, secret, and permission sections]**

### 4:40 — Validate Security Governance Pack (20s)
```bash
node scripts/amber.js pack validate --file workflow-packs/security-audit.pack.json
```
**[Show: Pack validation passes]**
"Security Governance reviews dependency, secret, permission, and secure-review evidence through declarative, dry-run-safe packs."

---

## 5:00-5:30 — Call to Action

"Amber Protocol keeps AI-assisted coding work repo-local, artifact-first, and reviewable. Service packages help you navigate the commands, but every command is real and under your control."

```bash
node scripts/amber.js --help
```

- ⭐ Star us on GitHub
- 📖 Read the docs at amber-protocol.dev
- 💬 Join our Discord community

"Happy building, and stay secure!"

---

## Setup Checklist

- [ ] Clean terminal with no previous output
- [ ] Current directory is an Amber Protocol clone or empty project
- [ ] Node >= 18.17 installed
- [ ] Recording software tested
- [ ] Microphone checked

# Phase B v1.0.0 Demo Script

**Duration:** 5:30  
**Presenter:** [Name]  
**Date:** June 10, 2026

---

## 0:00-0:30 — Problem Statement

**[Screen: Title card "Coding Harness Phase B"]**

"AI coding tools are powerful, but they need guardrails. Today I'll show you how Coding Harness Phase B makes AI-assisted development safe, auditable, and extensible."

---

## 0:30-2:00 — Key Features Demo

### 0:30 — Installation (15s)
```bash
npm install -g coding-harness
coding-harness --version
```
**[Show: v1.0.0 output]**

### 0:45 — Initialize Project (30s)
```bash
mkdir demo-project && cd demo-project
coding-harness init
coding-harness doctor
```
**[Show: Project structure with skills/, routes/, profiles/]**

### 1:15 — Security Audit (30s)
```bash
coding-harness security audit
```
**[Show: Audit report with dependency scan, secret scan, permission review]**
"Zero configuration — security is on by default."

### 1:45 — Create a Skill (15s)
```bash
mkdir -p skills/greeter
```
**[Show: SKILL.md content]**
"Skills are just Markdown files. No code needed."

---

## 2:00-3:30 — Migration Walkthrough

### 2:00 — V5.5 Project (20s)
**[Show: V5.5 settings.json with old format]**
"Here's a V5.5 project. Let's migrate it."

### 2:20 — Dry-Run (20s)
```bash
coding-harness migrate --dry-run
```
**[Show: Diff output showing what will change]**

### 2:40 — Apply Migration (20s)
```bash
coding-harness migrate
```
**[Show: New settings.json with Phase B format]**

### 3:00 — Verify (15s)
```bash
coding-harness validate
coding-harness route test default --dry-run
```
**[Show: Validation passes]**

### 3:15 — Rollback (15s)
```bash
coding-harness rollback --list
coding-harness rollback --restore .backup-2026-06-10-120000.json
```
"Migration is reversible. Your settings are never lost."

---

## 3:30-5:00 — Advanced Use Case

### 3:30 — Agent Profile (30s)
```bash
cat profiles/security-auditor.profile.json
```
**[Show: Profile with restricted tools, specific model, thinking budget]**

### 4:00 — Multi-Agent Route (30s)
```bash
cat routes/secure-deploy.route.json
```
**[Show: Worker → Reviewer → Deploy pipeline]**

### 4:30 — Run Route (30s)
```bash
coding-harness route test secure-deploy --dry-run
```
**[Show: Stage-by-stage execution preview]**

---

## 5:00-5:30 — Call to Action

"Phase B is available now. One command to install. One command to secure your project. One command to migrate from V5.5."

```bash
npm install -g coding-harness
```

- ⭐ Star us on GitHub
- 📖 Read the docs at coding-harness.dev
- 💬 Join our Discord community

"Happy building, and stay secure!"

---

## Setup Checklist

- [ ] Clean terminal with no previous output
- [ ] Current directory is empty or has demo-project
- [ ] All example content pre-created (SKILL.md, profiles, routes)
- [ ] Internet connection for npm install
- [ ] Recording software tested
- [ ] Microphone checked
- [ ] Backup Restore Keys: have timestamped backup path ready

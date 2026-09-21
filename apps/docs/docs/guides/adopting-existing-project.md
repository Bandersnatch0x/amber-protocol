---
id: adopting-existing-project
title: "Adopting an Existing Project"
sidebar_label: "Adopting an Existing Project"
description: "Step-by-step adoption guide: running audit, generating init scaffold, and configuring doctor."
---

import CommandBlock from '@site/src/components/command-block';

# Adopting an Existing Project

This guide explains how to adopt Amber Protocol on an existing codebase without disrupting existing build tooling or team workflows.

## Step 1: Pre-adoption Inspection

Run a read-only audit to inspect the existing project:

<CommandBlock
  context="Target Repository"
  nature="read-only"
  command="amber audit --target . --summary"
  expectedSignal="Project readiness score, existing documentation files, and scaffolding suggestions."
/>

## Step 2: Initialize Scaffolding

Scaffold Amber governance files without overwriting user files:

<CommandBlock
  context="Target Repository"
  nature="idempotent-write"
  command="amber init --target . --with-wiki"
  expectedSignal="Generated .amber/ directory structure, governance rules, and wiki skeleton."
/>

## Step 3: Verify Doctor Compliance

Run the Doctor suite to verify all guardrails:

<CommandBlock
  context="Target Repository"
  nature="read-only"
  command="amber doctor --target ."
  expectedSignal="✅ All Amber guardrail checks passed; 0 errors."
/>

## Step 4: Add Drift Gate to CI

To prevent governance and documentation drift, add a non-blocking or blocking drift step to your CI pipeline:

```yaml
- name: Amber Drift Gate
  run: npx amber-protocol drift --target . --format gh-annotations
```

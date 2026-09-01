---
id: governance-gates-and-audit
title: "Governance Gates & Readiness Audit"
sidebar_label: "Gates & Readiness Audit"
description: "Evaluating phase gates, checking drift in CI, and conducting readiness audits."
---

import CommandBlock from '@site/src/components/CommandBlock';

# Governance Gates & Readiness Audit

Amber Protocol uses deterministic gate evaluation and drift verification to guarantee that quality standards, evidence, and approvals are strictly met.

## Drift Checking in CI

The `amber drift` command verifies that artifacts, wiki files, schemas, and scaffolding have not drifted:

<CommandBlock
  context="Target Repository (CI)"
  nature="read-only"
  command="amber drift --target . --format gh-annotations"
  expectedOutput="Exit code 0 if fully in sync; non-zero if artifact/wiki drift detected."
/>

## Evaluating Gate Contracts

A Gate Contract defines explicit evidence criteria, minimum assurance levels, and thresholds:

<CommandBlock
  context="Target Repository"
  nature="governed-write"
  command="amber gate evaluate --target . --gate gate/release-readiness"
  expectedOutput="Appends immutable evaluated outcome event to .amber/gates/outcomes.jsonl."
/>

## Governance Readiness Report

To score overall repository governance maturity:

<CommandBlock
  context="Target Repository"
  nature="read-only"
  command="amber governance report --target ."
  expectedOutput="Readiness score, risk assessment, and structured next actions printed."
/>

---
id: glossary
title: "Public Governance Glossary"
sidebar_label: "Glossary"
description: "Authoritative definitions of Amber Protocol terms and concepts."
---

# Public Governance Glossary

Authoritative dictionary of Amber Protocol governance terms:

### Action Type
A declarative, schema-validated verb (e.g. `session.start`, `evidence.record`, `gate.evaluate`) exposed by Amber's operational ontology.

### Amber Setup
The initialized state within a target repository, encompassing the `.amber/` directory, rules configuration, and baseline governance files.

### Approval Record
A scoped, expiring, single-use authorization granted by a registered human Principal that allows a sensitive or mutating Decision to settle.

### Assurance Level
One of four fixed assurance tiers (`unavailable`, `observed`, `replayable`, `verified`) quantifying the trustworthiness and provenance of evidence.

### Decision
A canonical artifact revision recording an authoritative human or service determination (acceptance, review, or approval).

### Doctor
Amber's built-in rule validation engine (`amber doctor`) that checks repository conformity and health invariants.

### Evidence Receipt
An immutable, tamper-evident record binding producer identity, command, inputs, environment, and exit status.

### Gate Contract
A declarative specification defining required evidence types, minimum assurance levels, thresholds, and freshness bounds needed for progression.

### Handoff Bundle
A self-contained directory containing session summary, risks, evidence, next actions, and recovery commands for continuing work across sessions or agents.

### Policy Contract
A non-relaxable, deny-wins set of rules evaluated against approvals, gate outcomes, and separation-of-duties constraints.

### Principal
A registered identity (human or service) within Amber's principal ledger authorized to produce evidence, grant approvals, or settle decisions.

### Route
A predefined or custom state machine defining the ordered sequence of stages and gate checks required to complete an engineering objective.

### Session
An auditable unit of work containing an active manifest, timeline of events, and associated evidence receipts.

### Target Repository
The codebase directory specified via `--target <path>` that Amber inspects and governs.

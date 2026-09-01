---
id: amber-setup
title: "Amber Setup & Directory Structure"
sidebar_label: "Amber Setup"
description: "The .amber/ directory, scaffolding idempotency, rules, and configuration."
---

# Amber Setup & Directory Structure

When Amber is initialized in a target repository via `amber init --target .`, it creates a structured governance directory named `.amber/`.

## Directory Structure

```text
.amber/
├── governance/          # Policy rules, boundaries, and verification schemas
│   ├── rules.json       # Configurable rules for doctor and gates
│   └── POLICY.md        # Natural-language governance statement
├── sessions/            # Tracked engineering sessions
│   └── <session-id>/    # Individual session state & timelines
│       ├── manifest.json
│       └── timeline.jsonl
├── evidence/            # Recorded evidence receipts and verification claims
│   └── receipts.jsonl
├── gates/               # Gate evaluation outcomes and contracts
│   └── outcomes.jsonl
├── approvals/           # Single-use human authorizations
│   └── authorizations.jsonl
├── principals/          # Registered identities (human and service)
│   └── registry.jsonl
└── handoff/             # Resumable session handoff bundles
```

## Governance Configuration (`rules.json`)

The `.amber/governance/rules.json` file configures repository-specific constraints evaluated by `amber doctor` and `amber drift`.

Rules enforce invariants such as:
- Required agent documentation files (`AGENTS.md`, `CLAUDE.md`, or `README.md`)
- Supported Node/npm version ranges
- Disallowed execution patterns and sensitive file boundaries
- Evidence retention policies

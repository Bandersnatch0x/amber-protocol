---
type: agent
title: Context Loadout Definition
description: Contract for task-scoped context assembled by Amber.
tags: [agent, context]
updated: 2026-08-07
---

# Context Loadout Definition

A Loadout is a deterministic, budgeted JSON artifact under `.amber/context/loadouts/`.

## Required Artifacts

Load these before Context Pages:

1. `docs/wiki/agent/amber.md` as the Operating Manual.
2. `routes/<route>.route.json` as the selected Route manifest.
3. `docs/wiki/agent/context-loadout.md` as this Loadout Definition.

They appear only in `artifacts.required[]`. Each entry records `kind`, target-local `path`, `rawHash`, and estimated `words`. Missing files, target escapes, hash changes, or required-budget overflow block the Loadout.

## Context Pages

Context Pages remain in `tiers`, `pages`, and `references`. Required Artifacts are not Context Pages and do not appear in Page accounting.

## Loading

Run `amber context verify --loadout <file>` immediately before loading. Do not use a Loadout that fails verification.

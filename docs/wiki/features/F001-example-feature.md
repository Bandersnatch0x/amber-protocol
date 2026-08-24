---
type: feature
title: F001 Example Feature
description: Example feature page template.
tags: [feature]
updated: 2026-06-17
---

# F001 Example Feature

## User-Visible Behavior

A fresh agent can understand the project, run verification, and hand off work safely.

## Scope

In:

- Customize the Amber setup files for this repository.

Out:

- Dynamic workflow execution.
- Subagent dispatch.
- Automatic rewriting of old project documents.

## Acceptance Criteria

- Wiki pages describe product, architecture, engineering, and agent guidance.
- `feature_list.json` has project-specific features.
- Verification command is recorded.

## Verification

1. Read `docs/wiki/index.md`.
2. Run the command in `docs/wiki/engineering/verification.md`.
3. Run the Amber Protocol doctor from the toolkit repository.

## Architecture Notes

- The Amber setup is repository-local.
- Machine-readable state lives in `feature_list.json`.
- Stable context lives in `docs/wiki/`.

## Evidence

Record verification command output after customization.

## Open Questions

- What project-specific feature should replace this example?

## Unknowns / Needs Confirmation

- Confirm the project-specific feature ID, behavior, acceptance criteria, and verification evidence that should replace this example.

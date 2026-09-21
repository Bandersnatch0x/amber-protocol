---
id: session-handoff-and-continuity
title: "Session Handoff & Continuity"
sidebar_label: "Session Handoff & Continuity"
description: "Generating portable session handoff bundles and validating continuation state."
---

import CommandBlock from '@site/src/components/command-block';

# Session Handoff & Continuity

Amber keeps continuation state **in the repository**, not in the chat that produced it. A handoff is complete when a different developer, agent, or a fresh context window can continue with exactly one correct next step — without reading the previous conversation.

There are two artifacts, and they serve different readers:

| Artifact | Written by | Carries |
| --- | --- | --- |
| `session-handoff.md` | `amber handoff` | The live, regenerable view of current state for the operator staying in this repository. |
| Handoff bundle | `amber handoff bundle` | A portable, self-contained directory that can be moved to another machine or reader. |

## Step 1: Regenerate Live Handoff State

`amber handoff` rebuilds `session-handoff.md` from live state — features, the latest session, git, and the inferred next step — then validates it:

<CommandBlock
  context="Target Repository"
  nature="governed-append"
  command="amber handoff --target ."
  expectedSignal="session-handoff.md rewritten from live state and validated"
/>

The file is generated, not authored. Hand-editing it is what `amber handoff validate` is designed to catch: a handoff with a truncated or emptied section fails validation rather than silently misinforming the next reader.

### Required Sections

Validation requires each of these sections to be present **and non-empty**:

| Section | What it records |
| --- | --- |
| `Summary` | The latest session's id, goal, and status, plus a count of features by status. |
| `Repo State` | Current branch, whether the worktree is dirty, and the last commit. |
| `Runtime / Verification State` | The most recent evidence record: command, result, and when it ran. |
| `Feature State` | Every feature id with its status and title. |
| `Verification Evidence` | The recorded evidence entries backing those feature statuses. |
| `Blockers` | Features that are failing, or `None recorded.` |
| `Next Actions` | The single inferred next lifecycle step and the command that performs it. |

A regenerated handoff may also carry a `Learning write-back` section and a dirty-worktree section when those conditions apply.

## Step 2: Produce the Portable Bundle

To hand work to another machine or reader, write the bundle:

<CommandBlock
  context="Target Repository"
  nature="governed-append"
  command="amber handoff bundle --target . --output-dir .amber/handoff/latest"
  expectedSignal="Seven artifact files written to the output directory"
/>

Omitting `--output-dir` writes to `.amber/handoff/latest`. The bundle is a directory, not a single file:

| File | Contents |
| --- | --- |
| `README.md` | Target path, generation timestamp, readiness score, and the file inventory. |
| `session-summary.md` | The handoff summary section. |
| `verification-evidence.md` | Recorded evidence plus an evidence score and recent failed verification attempts. |
| `next-actions.md` | Each pending action with its severity, rationale, command, expected outcome, and what it blocks. |
| `risks.md` | Readiness findings and documentation staleness. |
| `recovery-commands.md` | The command sequence to re-establish state on a fresh machine. |
| `manifest.json` | Bundle metadata: artifact type, generation time, and the artifact inventory. |

## Step 3: Validate Before Handing Off

Never hand off an unvalidated bundle:

<CommandBlock
  context="Target Repository"
  nature="read-only"
  command="amber handoff validate --target . --bundle-dir .amber/handoff/latest"
  expectedSignal="Bundle validated: required artifacts present and manifest.json well-formed"
/>

Validation checks that every required file exists, that `manifest.json` parses as JSON, that its artifact type is `amber-handoff-bundle`, and that it lists the artifacts actually present. A bundle that fails validation is refused rather than partially trusted.

## Continuity Across Agents and Shifts

- **Fresh context, same repository**: read the bundle, then run `amber next` to get the one correct step. Do not reconstruct intent from a chat log.
- **Interrupted session**: `amber session continue` resumes from the recorded checkpoint instead of restarting the route.
- **Another machine**: ship the bundle directory; `recovery-commands.md` re-establishes state without requiring the original session.

## Boundaries & Safety

- **`session-handoff.md` is personal, generated state.** It is regenerated on demand and is not meant to be committed to a shared repository — Amber's own `.gitignore` advice (`amber team`) lists it alongside `notes.md` and `PROGRESS.md`. Commit the bundle only when a shared artifact is genuinely intended.
- **Target-scoped writes.** All reads and mutations are confined to `--target <repo>`.
- **Fail-closed validation.** Corrupt governance state, a malformed manifest, or a missing required section halts the command with a non-zero exit code.
- **No dynamic workflow execution.** Handoff generation records state; it does not dispatch agents, run target build or test commands, or schedule loop execution.

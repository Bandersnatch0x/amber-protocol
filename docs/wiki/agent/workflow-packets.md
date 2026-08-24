---
type: agent
title: Workflow Packets
description: Workflow packets and how they are used.
tags: [agent]
updated: 2026-06-17
---

# Workflow Packets

Use packets when the task has independent tracks, ambiguity, or enough risk that research and review should be separated from implementation.

Packets can be assigned to subagents when a runner exists. Without a runner, simulate roles by writing isolated packet notes under `.workflow/continuous-improvement/packets/` before synthesis.

## Flow

```text
researcher + researcher -> synthesizer -> writer + writer -> reviewer -> loop if rejected
```

For a linear task, use:

```text
research -> implement -> review -> verify -> record
```

## Research Contract

Before editing, record:

- Objective in one sentence.
- Files or modules in scope.
- Files or modules explicitly out of scope.
- Expected behavior or artifact after the change.
- Verification command or evidence.
- Approval gates.

## Packet Rules

- Researchers do not edit production files.
- Writers must respect synthesized decisions and non-overlapping ownership.
- Reviewers can accept, request rework, or escalate to user approval.
- Rejected packets loop back only through the failing packet.
- Final reports integrate decisions and evidence instead of pasting raw packet output.

## Packet Template

```text
Packet ID:
Role:
Objective:
Context:
Files / sources:
Ownership:
Do:
Do not:
Expected output:
Verification:
Status:
```

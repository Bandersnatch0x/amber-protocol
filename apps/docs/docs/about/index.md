---
id: index
title: "About Amber Protocol"
sidebar_label: "About Amber"
description: "Mission, design principles, and repository-local governance architecture."
slug: /about
---

# About Amber Protocol

Amber Protocol is an open-source governance framework created to establish clear operational boundaries, accountability, and verifiable evidence for AI coding agents.

## Core Architectural Principles

1. **Governance-First**: Strengthen verification, observability, and control surfaces before executing work.
2. **Read-Only by Default**: Commands default to reading state unless explicitly instructed to mutate.
3. **Idempotent Operations**: Initialization, scaffolding, and verification can be run repeatedly without unintended side effects.
4. **No Hidden State**: All governance data, timelines, ledgers, and evidence reside visibly in `.amber/`.
5. **Repository-Local**: Amber operates without cloud backends, remote agents, or proprietary daemons.
6. **Conservative Execution**: Amber refuses to autonomously rewrite project files, dispatch unreviewed live agents, or bypass security rules.

## Licensing

Amber Protocol is licensed under the [MIT License](https://github.com/Bandersnatch0x/amber-protocol/blob/master/LICENSE).

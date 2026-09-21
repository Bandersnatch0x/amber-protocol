---
id: installation
title: "Installation & Environment Requirements"
sidebar_label: "Installation"
description: "Supported Node and npm expectations, global installation, and in-repo development setup."
---

import CommandBlock from '@site/src/components/command-block';

# Installation & Environment Requirements

Amber Protocol requires a standard Node.js runtime environment. It has no native build toolchain dependencies and requires no database or daemon setup.

## Supported Environment Matrix

The compatibility expectations derive directly from repository release metadata:

| Environment | Supported Versions | Notes |
| --- | --- | --- |
| **Node.js** | `^20.19.0 \|\| ^22.12.0 \|\| >=23` | Validated continuously in CI on Node 20.x and 22.x lanes. |
| **npm** | `>=9.0.0` | Compatible with standard npm, pnpm, and yarn lockfile workflows. |
| **Operating Systems** | Linux, macOS, Windows (PowerShell / WSL) | Cross-platform directory path normalization and POSIX line endings. |

## Global Installation (Recommended)

To install the `amber` CLI globally across your development environment:

```bash
npm install -g amber-protocol
```

Verify your installation:

<CommandBlock
  context="Local Workstation"
  nature="read-only"
  command="amber --version"
  expectedSignal="1.6.0"
/>

## In-Repository Development Setup

If you are developing inside the Amber repository or using a checked-out copy:

```bash
# Clone the repository
git clone https://github.com/Bandersnatch0x/amber-protocol.git
cd amber-protocol

# Install root dependencies
npm install

# Run the CLI directly via Node
node scripts/amber.js doctor --target .
```

The bare CLI executable `amber <command>` and the script execution `node scripts/amber.js <command>` have identical behavior and accept the exact same options and arguments.

## Verification Signal

After installing, verify that Amber can inspect your target repository:

<CommandBlock
  context="Target Repository"
  nature="read-only"
  command="amber doctor --target ."
  expectedSignal="✅ Target repository classified and Amber guardrails checked."
/>

Next, follow the [First Governed Workflow](/start-here/first-governed-workflow).

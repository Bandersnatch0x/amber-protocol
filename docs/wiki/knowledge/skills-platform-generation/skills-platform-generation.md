---
kind: "knowledge"
category: "skills-platform-generation"
title: "Skills & Platform Generation"
template: "architecture"
updated_at: "2026-08-18T00:00:00.000Z"
---

# Skills & Platform Generation

Last Reviewed: 2026-08-18

Amber maintains one canonical skill definition per capability and generates the
platform-specific surfaces from it. The five directories under `skills/` are authored
inputs: the `amber` router plus four deep journeys. Claude Code, Codex/Cursor, and
Gemini files are products of the generator and must remain reproducible from those
inputs.

## Source and Outputs

- `skills/<name>/SKILL.md` is the source of truth for each Amber capability. Current
  authored skills are `amber` (router), `amber-delivery`,
  `amber-diagnosis-adoption`, `amber-context-continuity`, and
  `amber-continuous-improvement`.
- `scripts/gen-agent-commands.js` is the CLI entry for generation and check mode; it
  delegates generation to the shared agent-command generator. Before planning any
  product output, that module validates every `x-amber-json.command` against the
  Command registry's command/subcommand and documented option contract plus the CLI
  parser's value/boolean flag shapes. Invalid contracts return errors and write
  neither generated files nor stale-output removals.
- `.claude-plugin/` exposes the canonical skills to Claude as a plugin, while generated
  command surfaces are written under `.claude/`.
- `.agents/skills/` is the generated open-standard skill location consumed by Codex
  and Cursor.
- `.gemini/commands/amber/` contains generated Gemini command definitions.
- `package.json` scripts `gen:agents` and `gen:agents:check` write products and detect
  drift respectively.

## Generation Flow

```mermaid
flowchart LR
    Source["skills/*/SKILL.md"] --> Generator["scripts/gen-agent-commands.js"]
    Source --> Plugin[".claude-plugin references canonical skills"]
    Generator --> Claude[".claude/commands"]
    Generator --> Agents[".agents/skills"]
    Generator --> Gemini[".gemini/commands/amber"]
    Claude --> Drift["gen:agents:check"]
    Agents --> Drift
    Gemini --> Drift
```

The generator interprets skill metadata and body content, then renders the format each
platform expects. Check mode computes the same products without accepting drift, which
makes the canonical skill and generated outputs a single tested contract.

## Development Rules

- Edit `skills/<name>/SKILL.md`, then run `npm run gen:agents`. Do not directly edit
  generated platform files.
- Run `npm run gen:agents:check` before completion and in CI to prove all mirrors match
  the canonical skills.
- Keep capability semantics in the canonical skill. Platform renderers may adapt
  syntax and metadata, but must not introduce a different workflow.
- Add a new Amber skill as a source directory first and update generator tests for all
  supported outputs in the same change.
- Treat generation as deterministic repository maintenance; generated output should
  not depend on machine-specific paths, clocks, or mutable external services.
- Command contract truth stays centralized in `scripts/lib/command-registry.js` and
  parser flag shape stays in `scripts/lib/core/cli-output.js`. The generator consumes
  those existing projections directly; do not add a skill-only command/option
  allowlist or execute a skill command as part of generation.
- Skill instructions expose governed CLI behavior. They must not imply that Amber
  dispatches live agents or bypasses approvals on the user's behalf.

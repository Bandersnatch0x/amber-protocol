# F064: Improvement Suggestions (Web, Multi-Host)

**Spec ID:** F064
**Status:** Proposed
**Updated:** 2026-09-03
**Depends on:** Session Lens transcript reads (web), F023 learning write-back (knowledge surfaces), F025 break-loop recurrence threshold, F054 fingerprint/cooldown vocabulary, ADR-0001 (governance-first boundary), ADR-0014 (`next` is not an LLM router)
**Provenance:** Operator decision 2026-09-03: mount the suggestion surface on the web viewer; cluster friction across multiple coding-agent hosts; Apply may touch only agent-facing knowledge files.

## Problem Statement

Repeated agent friction is visible only as command output (learnings checkpoints, break-loop scaffolds, maintenance proposals) or as a single-host transcript. An operator watching Claude, Codex, and Cursor on the same repository cannot see one reviewable card that says: this failure came up N times, across these hosts, and here is a bounded knowledge-file change. Without that card, the last mile stays "go run another command", and each host's history stays a silo.

## Solution

Add **Improvement Suggestions** as a web-only observability and knowledge-write surface.

1. **Hosts.** Read repository-scoped transcripts from Claude Code, Codex CLI, and Cursor. Each host is an adapter behind one closed id (`claude|codex|cursor`). Missing homes, unreadable files, and unknown record shapes yield zero signals — never an error and never a cross-repo leak.
2. **Signals.** Extract tool-failure friction only (deterministic). No model, no scheduler, no idle-quota window. A host file ceiling bounds how many recent transcripts are scanned.
3. **Cluster and promote.** Fingerprint = tool name + normalized first error line. Promote when at least two distinct transcripts share a fingerprint. One-off noise never becomes a card. Host ids on a card are a union, not a second threshold.
4. **Plan.** A promoted cluster becomes one card: title, evidence count, host badges, excerpts (redacted), and operations (`create|update|remove` + artifact kind + repo-relative path + expected effect). V1 planner emits a wiki `create` under `docs/wiki/agent/friction/<slug>.md` (or `update` if that file already exists). It may describe a suggested `AGENTS.md` bullet in the wiki body; it does not write `AGENTS.md` unless a later revision adds that operation under the same allowlist.
5. **Review.** Web route `/suggestions` (nav + home entry). Actions: Preview, Apply, Snooze (7 days), Dismiss, Undo. Overlay status lives under `.amber/suggestions/` (gitignored runtime state).
6. **Apply.** All-or-nothing. Allowlist only: `AGENTS.md`, `CLAUDE.md`, `docs/wiki/**/*.md`, `skills/*/SKILL.md`. Create must not overwrite; update/remove must match the draft-time content hash. Path escape, `MEMORY.md`, tests, product code, and host-global config are refused. Undo restores the recorded previous bytes only if the file still matches what Apply wrote.

No new default CLI verb. `amber next` is unchanged. Suggestions are not Intents, not Maintenance Proposals, and not regression-test writes.

## User Stories

1. As an operator, I want a Suggestions page in the web viewer so I can review clustered friction without learning a new CLI verb.
2. As an operator using more than one coding agent, I want one card when Claude and Codex hit the same failure, so host silos do not hide recurrence.
3. As an operator, I want an evidence badge with session count and host names, so I can see the card is grounded in repeated records.
4. As an operator, I want Preview to show the exact wiki path and contents before Apply.
5. As an operator, I want Apply to refuse the whole card if any target changed, so a concurrent edit is never clobbered.
6. As an operator, I want Dismiss and Snooze to hide a card without writing knowledge files.
7. As an operator, I want Undo to restore the previous wiki bytes when I applied by mistake.
8. As a security owner, I want excerpts redacted and scans confined to the current repository.
9. As a product owner, I want product code and tests out of this Apply path, so a suggestion cannot skip the session lifecycle.

## Implementation Decisions

- Extraction, clustering, promotion, and planning are model-independent.
- Claude reuses the existing Session Lens reader; Codex reads `sessions/rollout-*.jsonl` under the Codex home; Cursor reads `chats/<cwd-hash>/` and `projects/<encoded-repo>/agent-transcripts/`. Compressed Codex rollouts (`.jsonl.zst`) and Cursor desktop SQLite stores are out of scope.
- Promotion threshold is two distinct transcript ids. Repeated failures inside one transcript do not promote.
- Runtime overlay is `.amber/suggestions/state.json` plus a directory `.gitignore` (same pattern as Session Lens digests).
- Web mutations are explicit tRPC procedures: `list`, `read`, `dismiss`, `snooze`, `apply`, `undo`.
- Default help, skills topology, and CLI verbs do not change.

## Testing Decisions

- Highest seam: fixture transcripts (Claude + Codex + Cursor) → signals → promoted card → preview contents → Apply wiki file → Undo.
- Unit tests cover promotion threshold, fingerprint merge across hosts, allowlist refusal, stale Apply, dismiss/snooze overlay, and redaction of excerpts.
- Router tests cover list/read and mutation pass-through.
- Playwright covers nav entry, card render with evidence badge, Preview, Apply, and the written wiki path in the e2e fixture repo.

## Out of Scope

- Gemini, external-host, and other hosts (adapter ids may be added later without changing the card contract).
- Conversation-wide LLM extraction, pain scores, or scheduled analysis.
- Applying to tests, application source, CI, dependencies, or `MEMORY.md`.
- A default CLI verb, MCP Action, or `amber next` rewrite.
- Global host config (`~/.claude`, `~/.codex`, `~/.cursor` settings files).

## Vocabulary

**Improvement Suggestion** — a reviewable, evidence-clustered change to agent-facing knowledge files. Distinct from a Maintenance Proposal (stale docs / drift / regression candidates) and from a Regression Proposal (test assertion, never auto-written).

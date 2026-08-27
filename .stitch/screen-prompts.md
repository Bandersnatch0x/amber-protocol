# Amber Protocol Web Viewer — Stitch Screen Prompts (Obsidian & Amber Pulse v10)

Use these prompts with the project design system in `.stitch/DESIGN.md` attached at the Stitch project level.
All screens implement the **Linear / Raycast 旗舰工装风 (Obsidian & Amber Pulse)** aesthetic: deep obsidian surfaces, 1px hairline borders, signature amber gold protocol glows, cobalt interactive elements, and Geist/JetBrains Mono typography.

---

## Shared App Shell

Apply this shell across all 10 screens:

**PLATFORM:** Web, desktop-first with mobile single-column reflow.

**APP SHELL STRUCTURE:**
1. **52px Glass Header (`backdrop-blur-xl`):**
   - **Left:** Amber polygon mark with amber micro-glow + repository moniker + git branch chip (`amber-protocol:main`) + Stitch projectId tag (`stitch#13148335678122809815`).
   - **Center:** Navigation tabs (Home, Sessions, Gates Inbox with pending counter badge, Timeline, Routes, Governance). Active tab has a luminous underline and subtle background tint.
   - **Right:** Repository Pulse Capsule `[ ● 2 Active | 1 Gate Pending | 96% Health ]` with live heartbeat aura + `Cmd+K` command palette trigger + dark/light theme switch.
2. **Infinite Canvas Background:** Deep obsidian (`#080B10`) with `24px` radial dot matrix pattern.
3. **Card Architecture:** Surface level 1 (`#0F141C`) with 1px hairline border (`rgba(255,255,255,0.08)` resting, `rgba(255,255,255,0.18)` hover), 8px radius, zero heavy drop shadows.
4. **State Handling:** Every data panel implements matching skeleton loading, inline retry error state, and actionable empty state.

---

## 01 - Home / Repository Control Surface

**ROUTE:** `/`

**SCREEN PURPOSE:** High-precision command deck providing an instant pulse of all agent sessions, pending governance checkpoints, and active repository health.

**PAGE STRUCTURE:**
1. **Repository Pulse Header:** Top cockpit summary showing current workspace root, git branch, live SSE connection heartbeat, and quick jump buttons to "Triage Gates (1)" and "Active Sessions (2)".
2. **Active Sessions Priority Rail:** Elevated cards for currently running/paused agent runs, featuring goal title, current route stage, elapsed time, and 1-click drill-down to Session Detail or Timeline.
3. **Governance Readiness Matrix (Readiness Health Bars):** 5-dimension linear health bars (Governance, Evidence, Continuity, Safety, Maintenance) with percentage scores and 1-click copyable CLI remediation commands (`CommandCopyBlock`).
4. **Lifecycle Stage Progress Ribbon:** Compact, connected step chain (`Audit → Init → Plan → Gate → Verify → Handoff → Learnings`) with active stage highlighting and blocker alerts.
5. **Durable Evidence Shelf:** Compact grid of repository-local evidence files (`AGENTS.md`, `feature_list.json`, `session-handoff.md`, `docs/wiki/`) with last-modified timestamps and quick-view affordances.

---

## 02 - Sessions List

**ROUTE:** `/sessions`

**SCREEN PURPOSE:** Operational session index for developers monitoring concurrent autonomous coding tasks.

**PAGE STRUCTURE:**
1. **Header & Density Bar:** Page title "Sessions", filtered count badge, search input with `/` shortcut, status filter dropdown (All, Idle, Running, Executing, Paused, Completed, Failed, Aborted), and a compact row-density toggle.
2. **Interactive Session Rows:** High-density stacked rows. Active running sessions feature a pulsing cobalt/amber indicator.
3. **Row Metadata Cluster:** Session Goal (primary bold line), shortened session ID in monospace, route tag, active stage chip, token budget consumption (tabular numerals), and relative timestamp.
4. **Quick Action Hover Trigger:** Hover reveals quick actions: "View Timeline", "Inspect Gates", and "Abort" (danger outline).
5. **State Handling:** 3-row skeleton loader matching density; filtered empty state with 1-click "Clear Filters".

---

## 03 - Session Detail

**ROUTE:** `/sessions/$id`

**SCREEN PURPOSE:** Live control deck answering three questions instantly: What is the agent doing now? Is human intervention required? What is the current evidence trail?

**PAGE STRUCTURE:**
1. **Session Control Header:** Back link, lifecycle status badge, full session ID in monospace with 1-click copy, session goal title, and primary actions (Pause/Resume/Abort).
2. **Live Heartbeat Status Bar:** Dual-state readout showing session lifecycle vs SSE connection health (Live/Connecting/Disconnected/Error) + latest activity summary with sub-second relative timestamp.
3. **Execution Context Panel:** Route stage progression, active worktree branch/path, elapsed time, token budget gauge, and active gate alert if paused.
4. **Interactive AST / JSON Manifest Inspector:** Searchable, collapsible key-value tree viewer with copy-path and copy-value support, replacing plain `<pre>` blocks.
5. **Destructive Confirmation Drawer:** Abort confirmation modal with clear blast-radius explanation, Cancel, and Abort action.

---

## 04 - Session Timeline

**ROUTE:** `/sessions/$id/timeline`

**SCREEN PURPOSE:** Chronological event explorer revealing sub-second execution deltas, tool call traces, and human intervention points.

**PAGE STRUCTURE:**
1. **Header & Time Filter:** Title "Session Timeline", total duration summary, event count ("24 of 24 events"), event-type multi-filter (ToolCalls, FileOps, Prompts, Gates, Errors), and search input.
2. **Vertical Timeline Rail with Micro-Deltas:**
   - Categorized glyphs for event types: Terminal (Bash), Disk (File Read/Write), Network (Web/API), Lock (Gate Checkpoint), Chat (LLM Turn).
   - **Sub-second micro-deltas** (`+180ms`, `+2.4s`) computed between consecutive events.
   - **Chronology-Gap Awareness:** Human approval pauses or long tasks (>60s) render with a dashed break line and human time (e.g. `— 14m 20s waiting on human review —`).
3. **Expandable Event Detail Card:** Clean summary header; expanding reveals formatted parameters, stdout/stderr excerpts, and raw JSON payload with search.
4. **Fast Scrubber Rail:** Sticky minimap on the right allowing instant jumps through long timeline traces (>50 events).

---

## 05 - Routes List

**ROUTE:** `/routes`

**SCREEN PURPOSE:** Visual catalog of governed engineering workflows and autonomous loop routes.

**PAGE STRUCTURE:**
1. **Header:** Title "Workflow Routes", route count, search bar with `/` keyboard hint.
2. **Grouped Route Grid (2-Column Dense):** Grouped by category (Delivery, Diagnosis, Context, Continuous Improvement).
3. **Route Card Architecture:** Route display name, route ID in monospace, complexity tier badge (Low/Medium/High), stage count, gate count, and concise purpose description.
4. **State Handling:** 6-card skeleton loading, filtered no-match state.

---

## 06 - Route Detail

**ROUTE:** `/routes/$id`

**SCREEN PURPOSE:** Deep inspection of an execution route's machine-facing stages, gate triggers, and governance constraints.

**PAGE STRUCTURE:**
1. **Header:** Back link, route title, route ID, complexity chip, version tag.
2. **Ordered Stage Flow Column:** Step-by-step stage cards with stage name, execution target, command regex pattern, and inline lock indicator for stages with required gates (`Gate: user-approval`).
3. **Route Metadata Side Panel:** Author, validity scope, gate prerequisites, and execution policies.

---

## 07 - Gates (Split-View Triage Workbench)

**ROUTE:** `/gates`

**SCREEN PURPOSE:** High-efficiency Master-Detail cockpit for triaging human approval checkpoints with zero context switching.

**PAGE STRUCTURE:**
1. **Split-View 2-Column Layout:**
   - **Left Column (Master Triage Rail - 380px):** High-density list of pending and resolved gates. Filter tabs (Pending, Approved, Rejected). Each item displays gate ID, stage tag, waiting duration, and trigger urgency. Keyboard `J/K` roams items.
   - **Right Column (Detail & Decision Inspector - Flex):**
     - **Gate Context Card:** Full prompt, trigger reason, machine-facing stage name, and physical `gate.json` file path.
     - **Live Audit Evidence & Ledger Card:** Ledger hash chain verification seal (`LEDGER VERIFIED`) + inline Git Diff snapshot of staged mutations.
     - **Decision Control Footer (Sticky):** Reviewer ID input field, `⌘+↵` Approve & Resume button with amber glow, `⌘+⇧+↵` Reject with Reason drawer.
2. **Governance Safety Invariant:** High-risk `user-approval` gates enforce mandatory individual inspection and valid Reviewer signature before decision emission.

---

## 08 - Transcripts List

**ROUTE:** `/transcripts`

**SCREEN PURPOSE:** Archival directory for durable, redacted Claude Code agent session logs.

**PAGE STRUCTURE:**
1. **Header:** Title "Transcripts", subtitle "Read-only transcript records (secrets redacted)", total log count, search input by ID or branch.
2. **Archival Navigation Rows:** Clean tabular rows with transcript ID prefix in monospace, git branch chip, turn count, and timestamp.
3. **Tone:** Strictly archival and evidence-based; no live polling indicators.

---

## 09 - Transcript Detail

**ROUTE:** `/transcripts/$id`

**SCREEN PURPOSE:** High-legibility reader for multi-turn model prompts, tool executions, and file diffs.

**PAGE STRUCTURE:**
1. **Header:** Back link, transcript ID title, turn count, "secrets redacted" badge, and tertiary action buttons (Save Digest, Propose Regressions).
2. **Single-Column Turn Stream:** Document-like reading measure. Neutral role badges (User, Assistant, System, Tool), tool call chips, timestamp, and syntax-highlighted code/diff blocks with copy controls.
3. **Turn Search & Jump:** Quick-filter by tool name or search within conversation turns.

---

## 10 - Settings

**ROUTE:** `/settings`

**SCREEN PURPOSE:** Local client display, refresh interval, and notification preferences.

**PAGE STRUCTURE:**
1. **Header:** Title "Settings".
2. **Single-Column Stacked Preference Sections:**
   - **Appearance:** Theme toggle (Obsidian Dark / Porcelain Light), Compact Density toggle, Font selection (Geist / Inter).
   - **Polling & Updates:** Live SSE toggle, fallback polling interval slider (1s to 60s).
   - **Notifications:** Desktop notification toggle for session completions and gate blockers.
3. **Save Footer:** Right-aligned dirty-gated "Save Settings" button (`⌘+S`) with inline success/failure status.

## 11 - Knowledge Map

**ROUTE:** `/knowledge`

Interactive read-only map of the repository's knowledge and decisions: ADRs, wiki knowledge pages, and features as nodes; trace relationships as edges.

**PLATFORM:** Web, desktop-first with mobile collapse to a searchable list.

**SCREEN PURPOSE:** Let a developer or incoming agent answer three questions from one surface: what knowledge exists in this repository, how decisions and features connect to each other, and what changed recently or has gone stale. This is an evidence viewer, not an editor. Nothing on this screen mutates repository state.

**PAGE STRUCTURE:**
1. **Header:** Title "Knowledge Map", quiet supporting copy such as "Committed knowledge artifacts and their trace relationships", and compact counts as plain secondary text such as "86 nodes · 112 edges".
2. **Filter bar:** Search input with placeholder "Search nodes..." and a quiet visible `/` hint. Node-kind filter chips for Decision Record, Knowledge Page, Feature, Architecture Page, with live counts per kind. An optional "Drift only" toggle that filters the map down to nodes with drift badges. Filters update the counts in the header.
3. **Map canvas:** The primary surface is an interactive graph with pan and zoom. Nodes are visually distinct by kind through compact badges or shape cues, each showing a short label such as "ADR-0021", "F058", or "governance-model". Node clusters group loosely by kind without hard containers. Edges render as thin quiet lines; hover or selection may reveal a small edge-type label such as "supersedes", "builds on", "refines", "realizes", or "references". A small unobtrusive overview minimap sits in a canvas corner. When search matches, non-matching nodes dim and matching nodes stay full-contrast with a subtle ring.
4. **Node detail side panel:** Clicking a node opens a right-side panel. Panel content: node kind badge, node title, a two-to-three-line summary, source path in monospace such as `docs/adr/0021-...md`, and relationship groups listed as "Points to" and "Referenced by" with compact clickable rows that navigate the map to those nodes. A quiet tertiary action "Open source" links out to the file. The panel closes with an explicit control and Escape.
5. **Recent & Drift module:** A collapsible side section or below-canvas panel with two compact groups. "Recent" lists the latest knowledge changes as quiet rows, for example a new decision record, a feature status change, or a docs commit, each with a short relative time. "Drift" lists coverage gaps and stale documents as subdued warning rows, for example "Session & Lifecycle Management: declared in knowledge plan, no covering page". Drift rows correspond to drift badges on map nodes.
6. **State handling:** Loading shows a canvas-sized skeleton with filter bar placeholder. Error is inline with Retry and a calm explanation. Empty state explains that the map renders committed knowledge artifacts and points to the wiki knowledge plan as the place to declare them.
7. **Legend:** A compact legend explains node kinds and edge types without leaving the screen.
8. **Mobile behavior:** Collapse the canvas to a simplified list of nodes grouped by kind with the same search and filters; relationship traversal moves into the node detail panel. Recent & Drift stacks below.

**CONTENT GUIDANCE:** Use realistic Amber artifacts: decision records numbered ADR-0001 through ADR-0024 with titles like "Web console role — supervised action viewer"; features like F049 Canonical Planning Artifacts, F058 Instruction-Surface Adversarial Evals; knowledge pages like governance-model-seven-layers, cli-architecture-command-dispatch, web-dashboard; architecture pages like overview and data-flow. Edge examples: "ADR-0021 refines ADR-0012", "F058 realizes ADR-0011", "ADR-0007 supersedes web-viewer.md statement".

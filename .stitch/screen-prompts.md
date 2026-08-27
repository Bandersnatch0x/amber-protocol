# Amber Protocol Web Viewer - Stitch Screen Prompts

Use these prompts with the project design system in `.stitch/DESIGN.md` attached at the Stitch project level. Per-screen prompts intentionally avoid color, font, and radius values because the project design system owns those decisions.

## Shared App Shell

Apply this shell to every web screen:

**PLATFORM:** Web, desktop-first with mobile responsive collapse.

**PAGE STRUCTURE:**
1. **Sticky top navigation:** Amber compact mark and product name on the left. Navigation items: Sessions, Transcripts, Routes, Gates, Knowledge, Settings. Theme toggle and docs affordance on the right. Active navigation item is visibly selected. On mobile, keep the product mark in the top row and move navigation into a horizontally scrollable secondary row.
2. **Main container:** Constrained width, responsive horizontal padding, quiet vertical rhythm, no splashy hero treatment.
3. **State model:** Every data surface needs loading skeleton, inline error with retry where applicable, and an empty state that explains what the operator can do next.
4. **Tone:** This is a repository-local developer tool. No marketing layout, no decorative charts, no hero metrics, no glass, no oversized cards.

## 01 - Home / Repository Control Surface

**ROUTE:** `/`

Operator home for repository-local AI coding sessions.

**PLATFORM:** Web, desktop-first.

**PAGE STRUCTURE:**
1. **Operator header:** Compact page title such as "Amber Operator Console", quiet supporting copy about reviewing sessions, timelines, gates, and transcript evidence for this repository, and two primary workflow actions: "Open Sessions" and "Review Gates". This is not a hero.
2. **Repository identity module:** A restrained panel showing current repository name or path, viewer freshness such as last refresh, and a quiet inline stale or loading state when data is lagging.
3. **Primary workflow surfaces:** Sessions and Gates should read as the primary entry points. Routes, Transcripts, and Settings can appear as secondary navigation surfaces with short practical descriptions.
4. **Governance reference:** A compact, de-emphasized lifecycle reference for Audit, Init, Plan, Gate, Verify, and Handoff. It should feel like a tucked-away operator aid rather than the page headline.
5. **Evidence references:** A compressed module showing repository-local evidence artifacts such as `AGENTS.md`, `feature_list.json`, `PROGRESS.md`, `session-handoff.md`, `docs/wiki/`, and `.workflow/continuous-improvement/state.json`.
6. **State handling:** Include practical loading, error, and empty states without turning the page into a dashboard.

## 02 - Sessions List

**ROUTE:** `/sessions`

Session index for developers monitoring autonomous coding tasks.

**PLATFORM:** Web, desktop-first with mobile filter stacking.

**PAGE STRUCTURE:**
1. **Header:** Title "Sessions" and a compact filtered count such as "8 sessions".
2. **Filter bar:** Search input with placeholder "Search sessions..." plus a quiet visible `/` hint, and a status select with All Statuses, Idle, Running, Executing, Paused, Completed, Aborted, Failed.
3. **Session rows:** Main content is a restrained vertical stack of interactive rows, not a gallery of cards.
4. **Sorting and hierarchy:** Active sessions appear first, then items are ordered by most recent activity. Show the goal title as the clear primary line. Use last activity or updated time, not created date, as the main time signal.
5. **Metadata treatment:** Secondary metadata stays compact and subdued: shortened session id in monospace, route id, and last activity timestamp. Running and Executing should read as one active blue state in the list view. Failed and Aborted may keep stronger alert styling.
6. **Budget treatment:** Show token budget only when present and meaningful, as compact text rather than a progress-heavy widget.
7. **State handling:** Loading uses three skeleton rows matching final density. Error is inline with Retry. Empty states must distinguish between a filtered no-match state and a repository with no sessions.
8. **Mobile behavior:** Stack filters cleanly and keep each row title-first, metadata-second.

## 03 - Session Detail

**ROUTE:** `/sessions/$id`

Detailed live control surface for a single autonomous coding session.

**PLATFORM:** Web, desktop-first with mobile single-column collapse.

**SCREEN PURPOSE:** Help an operator answer three questions quickly: what is happening now, what can I do now, and what context matters if I need to intervene.

**PAGE STRUCTURE:**
1. **Header:** Back link to Sessions, lifecycle status badge, full session id in monospace, and the session goal as the page title. If completed, a quiet success note may appear, but it must not overpower the main status.
2. **Live status bar:** A compact top panel with two clearly separated truths: session lifecycle status and connection state. Show connection labels such as Live, Connecting, Disconnected, or Error without letting them visually contradict session lifecycle. Include a compact latest-activity summary with the most recent event label plus relative time and access to the exact timestamp. Action controls should show only the actions valid for the current lifecycle state. Keep Abort visually separated as destructive.
3. **Main details column:** A restrained details panel with route, created timestamp, updated timestamp, timeline event count, and worktree active or inactive state with minimal extra context such as branch or path when available. Event count is secondary metadata, not the headline. Budget information should appear only when present and should read as quiet operational text with optional compact progress treatment, never as a hero metric. Primary deeper-drill action is View Timeline.
4. **Manifest inspection:** A metadata snapshot module that is collapsed by default. In collapsed state, show only a short monospace preview and helper copy. In expanded state, show scrollable formatted JSON. On narrower screens this module should move below the primary content so it feels like an inspection tool rather than the page's main job.
5. **Abort confirmation state:** Destructive confirmation with concise consequence copy, Cancel, and Abort.
6. **Error handling:** Use skeleton header and cards for loading. For confirmed not-found, show a calm explanation and Back to Sessions. Use Retry only for transient fetch failures.
7. **Mobile behavior:** Preserve top-of-page trust by keeping status, latest activity, and valid actions visible before lower-priority metadata.

## 04 - Session Timeline

**ROUTE:** `/sessions/$id/timeline`

Chronological event explorer for one session.

**PLATFORM:** Web, desktop-first with mobile event cards.

**SCREEN PURPOSE:** Preserve chronology truth while still allowing filtering and fast operator scanning.

**PAGE STRUCTURE:**
1. **Header:** Back link to Session, title "Timeline", session goal as supporting text, and event count such as "17 of 23 events". If filters are active, make it clear the operator is viewing a filtered subset rather than the full stream.
2. **Muted summary:** Optional compact definition-list summary only when data is meaningful. Keep it text-first and limited to 2 or 3 facts such as Total Duration, Started At, and a restrained event-type summary. No large numerals, colorful strips, or dashboard treatment.
3. **Filter bar:** Event type select and search input. Controls stack on narrow screens.
4. **Timeline rail:** Vertical rail with event cards. Preserve global event numbering from the full event stream even when filters are active. Any "since previous" interval must be computed from the real previous event in the full chronology, not the previous visible filtered item. Each card should make event title, event type, and absolute timestamp with seconds and timezone or local offset primary. Offset chips are secondary. Keep the detail grid compact and limited to fields that explain the event rather than dumping every field at equal weight.
5. **Filtered gaps:** When filters hide events between two visible cards, show a subtle gap indicator such as "5 events hidden by filters" so the operator does not infer false continuity.
6. **Expanded event:** Low-emphasis disclosure with divider, "Raw event" label, and a capped-height scrollable formatted JSON block. Search should prioritize title, type, and curated visible detail fields rather than making raw JSON the primary reading mode.
7. **State handling:** "No events recorded yet" for a true empty timeline, or "No events match your filters" with Clear filters when the filtered subset is empty. Error state is inline and calm.
8. **Mobile behavior:** Maintain scanability by preserving primary event identity first and pushing raw payload inspection behind disclosure.

## 05 - Routes List

**ROUTE:** `/routes`

Route catalog for governed workflow definitions.

**PLATFORM:** Web, desktop-first.

**SCREEN PURPOSE:** Help developers scan and compare available workflow routes quickly without the page drifting into a feature-grid feel.

**PAGE STRUCTURE:**
1. **Header:** Title "Routes" and a filtered route count.
2. **Search:** Single search input with placeholder "Search routes..." plus a quiet visible `/` hint that focuses search.
3. **Grouped route sections:** Routes are grouped by explicit categories in a stable, predictable order, with compact subdued category labels and small counts. Within each section, routes should also be ordered predictably.
4. **Route entries:** Use a restrained dense grid that behaves more like a list-dense tool surface than a marketing card grid. Keep it to at most two columns on wide desktop and one column on smaller widths. Each entry has route name as the primary line, route id in monospace, short description clamped to one or two lines, and stage count aligned consistently.
5. **Visual tone:** Low elevation, tight spacing, restrained borders, no oversized icons, no equal-weight feature-card vibe.
6. **State handling:** Loading uses six skeleton entries matching final density. Error is inline with Retry. Distinguish between a true empty catalog and a filtered no-match state. When search filters everything out, say "No matching routes" and keep the search context obvious.
7. **Filtering behavior:** Search filters routes live, updates counts to reflect filtered results, and hides empty sections during filtering.
8. **Mobile behavior:** Collapse to one column while preserving name-first scanability and compact metadata alignment.

## 06 - Route Detail

**ROUTE:** `/routes/$id`

Definition detail for a governed workflow route.

**PLATFORM:** Web, desktop-first with mobile single-column collapse.

**SCREEN PURPOSE:** Make one route inspectable at both the workflow level and the machine-facing stage level, using the real Amber route model rather than invented dashboard metadata.

**PAGE STRUCTURE:**
1. **Header:** Back link to Routes, route display name as title, route id in monospace, and a compact neutral complexity badge derived from trigger complexity when present.
2. **Main column:** Description panel with route purpose. Stages panel with ordered stage rows. Each stage row should show display name as the primary line and may include compact secondary machine-facing details such as stage name, type, target, and note when available. Show machine-facing strings in subdued monospace treatment with wrapping or truncation rules so long regexes and commands stay readable without taking over.
3. **Stage semantics:** Keep gate information attached inline to the relevant stage via gate-after labeling or a small lock-marked note. Never render Gate as its own standalone stage row. Use realistic Amber route examples such as Capture Requirements, Create Plan, Implement Feature, Run Verification, Reproduce Bug, Apply Fix, Characterize Behavior, and Refactor Code. Each stage row gets one primary line, one compact secondary detail line or cluster, and an optional inline gate note. No nested cards, tables, or dumps inside the row.
4. **Metadata side panel:** Restrained key-value metadata using real route fields: complexity, version, goal pattern, gate count, and optional author or tags only when present.
5. **Visual tone:** Quiet developer-tool inspection surface, no dashboard strip, no oversized badges, no decorative cards.
6. **State handling:** Loading uses skeleton back link, title, description card, stages card, and metadata card so the final shape stays stable. Error state is a calm not-found panel with Back to routes.
7. **Mobile behavior:** Collapse to one column while preserving route identity first, ordered stages second, metadata third.

## 07 - Gates

**ROUTE:** `/gates`

Approval checkpoint inbox for human review.

**PLATFORM:** Web, desktop-first.

**SCREEN PURPOSE:** Help a developer triage approval checkpoints quickly and confidently from a calm inbox surface.

**PAGE STRUCTURE:**
1. **Header:** Title "Gates", short explanatory copy about approval checkpoints, and a compact filtered gate count as plain secondary text.
2. **Filter:** Status select with All Gates, Pending, Approved, Rejected.
3. **Default ordering:** Pending items should naturally read as the most important operational state, with newest or most recently triggered items first.
4. **Main list:** Use stacked clickable inbox rows on a shared surface with subtle borders or dividers, no shadow, no equal-weight cards, and no inline approve or reject controls on this list page. Make the whole row clickable with a subdued hover or focus treatment and a small trailing review affordance.
5. **Row hierarchy:** Description is primary. Each row also shows gate id in monospace, status badge, stage name, short session id, and one compact subdued time signal. Prefer "Waiting since" for pending rows and "Reviewed at" for approved or rejected rows; if that data is inconsistent, use a neutral "Updated" label. Pending rows should feel reviewable, not alarmist.
6. **State handling:** Loading uses three skeleton rows matching final density. Error is inline with Retry. For no gates, explain that agents pause at gates for human review. For filtered empty states, say "No pending gates", "No approved gates", or "No rejected gates" as appropriate.
7. **Mobile behavior:** Keep description first and metadata second so rows remain scannable on narrow screens.

## 08 - Transcripts List

**ROUTE:** `/transcripts`

Read-only transcript index for Claude Code sessions in the repository.

**PLATFORM:** Web, desktop-first.

**SCREEN PURPOSE:** Let developers quickly locate and open durable transcript records without confusing transcripts with live session monitoring.

**PAGE STRUCTURE:**
1. **Header:** Title "Transcripts", a quiet subtitle close to literal product copy such as "Read-only transcript records for this repository (secrets redacted)", and a separate compact transcript count.
2. **Search:** Input with placeholder "Search by id or branch..." and a quiet visible `/` keyboard hint.
3. **Transcript rows:** Stacked restrained navigation rows. Each row navigates only to transcript detail and must not include status badges, primary actions, live indicators, or prominent card-heavy treatment. Keep the affordance row-like and archival.
4. **Row hierarchy:** Transcript id prefix in monospace and optional git branch chip are the locator fields. The branch chip should be neutral and subdued, not semantic. Turn count and last timestamp are compact secondary metadata.
5. **Tone:** Make the screen clearly archival and read-only rather than active or operational.
6. **State handling:** Loading uses three skeleton rows. Error is inline with Retry. If no matches, say "No transcripts match your search". If no transcripts exist, explain that transcripts are durable records of model and tool-call interactions for Claude Code sessions in this repository.
7. **Mobile behavior:** Make rows a clear two-line stack with transcript id and branch first, then turn count and timestamp second.

## 09 - Transcript Detail

**ROUTE:** `/transcripts/$id`

Readable transcript viewer for redacted model and tool-call records.

**PLATFORM:** Web, desktop-first with mobile readable single-column stack.

**SCREEN PURPOSE:** Let a developer read one durable transcript record, inspect turns safely, and trigger secondary evidence actions without confusing the page with a live session or dashboard surface.

**PAGE STRUCTURE:**
1. **Header:** Back link to Transcripts, transcript id prefix in monospace as the page title, a quiet turn count plus "secrets redacted" note, and two compact tertiary header actions: Save digest and Propose regressions.
2. **Action treatment:** Both actions are compact outline or ghost buttons in the trailing header area, never primary CTAs and never full-width on mobile. Success and error feedback stays one-line and inline immediately adjacent to the action cluster.
3. **Long transcript notice:** If there are 50 or more turns, show a compact info row with total turn count and a note that the full conversation is available below.
4. **Turn list:** Prefer a document-like single-column list with thin dividers or very light 1px containers rather than operational cards. Cap the readable text measure on wide desktop so long engineering turns stay easy to scan. Each turn shows a neutral role badge, optional neutral tool chips, a quiet absolute timestamp, and pre-wrapped text content.
5. **Color discipline:** Keep role badges and tool chips neutral, subdued, and optionally monospace where useful. Reserve blue for links, focus, and compact actions. Reserve semantic colors only for success, warning, and error feedback.
6. **Tone:** This is an evidence reader. No live indicators, no connection status, no hero stats, no progress motifs, and no dashboard grouping.
7. **State handling:** Loading uses a skeleton row. Error is an inline error panel with the message.
8. **Mobile behavior:** Keep role identity and timestamp in the header row, content below, and preserve readable wrapping.

## 10 - Settings

**ROUTE:** `/settings`

Local display and update preferences for the web viewer.

**PLATFORM:** Web, desktop-first but narrow form column.

**SCREEN PURPOSE:** Expose a small set of local viewer preferences clearly, using native-feeling controls and calm feedback.

**PAGE STRUCTURE:**
1. **Header:** Title "Settings".
2. **Layout guardrail:** This is a single-column local tool page with simple stacked bordered sections only. No sidebar, no avatars, no icons, no subnavigation, no card grid, and no dashboard summary elements.
3. **Display panel:** Compact View checkbox with helper text "Reduce padding and spacing in lists".
4. **Updates panel:** Auto Refresh checkbox with helper text "Poll for new session and timeline data at a regular interval". When enabled, show a native full-width Refresh Interval range input from 1s to 60s with `1s`, the current value, and `60s` as the only scale text.
5. **Notifications panel:** Show Notifications checkbox with helper text "Alerts when sessions complete or fail".
6. **Save model:** Use a dirty-gated explicit save flow. Save Settings stays disabled until something changes, becomes temporarily disabled while saving, and is the only blue control on the page.
7. **Action row:** Right-aligned Save Settings primary action with inline same-row feedback only: green "Saved" on success and red text on failure. No toast, banner, or modal.
8. **Tone and accessibility:** Quiet local preferences screen, not a profile page or account settings dashboard. Controls remain keyboard accessible and use native checkbox and range semantics aligned with the design system.

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

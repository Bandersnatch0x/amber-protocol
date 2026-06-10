> **Status**: 🟡 SCAFFOLD ONLY — 7 config files created, 0 pages/components. Deferred — see progress.md.\n>\n# Phase C — Web Viewer: Next.js Dashboard (8 weeks)

**Created:** 2026-06-10  
**Status:** Planning  
**Dependencies:** Phase B CLI complete  
**Duration:** 8 weeks  
**Parallel Track:** Can run alongside Phase B Beta

## Overview

Build a Next.js 14 web dashboard for session visualization, route browsing, timeline inspection, and session control. Reads `.harness/sessions/` filesystem via tRPC, provides real-time updates via SSE, and allows gate approval + session control.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript (strict)
- **API:** tRPC 10, Zod validation
- **UI:** Tailwind CSS, shadcn/ui, Radix UI primitives
- **State:** React Query (via tRPC), Zustand (client state)
- **Real-time:** Server-Sent Events (SSE)
- **Testing:** Playwright (E2E), Vitest (unit)
- **Dev:** ESLint, Prettier, Husky pre-commit

## File Structure

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── sessions/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       └── timeline/page.tsx
│   │   ├── routes/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── wiki/
│   │   │   ├── page.tsx
│   │   │   └── [...slug]/page.tsx
│   │   ├── settings/page.tsx
│   │   └── api/
│   │       ├── trpc/[trpc]/route.ts
│   │       └── sse/route.ts
│   ├── components/
│   │   ├── ui/          # shadcn/ui components
│   │   ├── sessions/
│   │   ├── routes/
│   │   ├── timeline/
│   │   ├── wiki/
│   │   └── layout/
│   ├── server/
│   │   ├── trpc.ts
│   │   ├── routers/
│   │   │   ├── session.ts
│   │   │   ├── route.ts
│   │   │   ├── timeline.ts
│   │   │   └── wiki.ts
│   │   └── context.ts
│   ├── lib/
│   │   ├── session-reader.ts
│   │   ├── route-reader.ts
│   │   ├── timeline-reader.ts
│   │   ├── wiki-reader.ts
│   │   └── sse-manager.ts
│   └── types/
│       ├── session.ts
│       ├── route.ts
│       └── timeline.ts
├── tests/
│   └── e2e/
│       ├── session-list.spec.ts
│       ├── session-detail.spec.ts
│       ├── timeline.spec.ts
│       └── session-control.spec.ts
└── package.json
```

## Week C1-C2: Foundation (2 weeks)

### Task C1.1: Project Scaffolding
- [ ] Create Next.js 14 app with TypeScript + App Router
- [ ] Configure Tailwind CSS + PostCSS
- [ ] Install shadcn/ui CLI and init components
- [ ] Set up ESLint + Prettier + Husky pre-commit
- [ ] Configure tsconfig.json (strict mode, paths)
- [ ] Create base layout with dark/light theme provider

**TDD Steps:**
1. Write test: `apps/web/tests/e2e/app.spec.ts` verifying app renders
2. Run test → RED (app doesn't exist)
3. Run `npx create-next-app@latest apps/web --typescript --tailwind --app --no-src-dir`
4. Run test → GREEN
5. Write test: theme toggle switches classes
6. Implement theme provider + toggle → GREEN

**Acceptance:** App runs on `localhost:3000`, theme toggle works, TypeScript strict passes

---

### Task C1.2: tRPC Server Setup
- [ ] Install tRPC 10 + @trpc/server + @trpc/client + @trpc/react-query
- [ ] Create `src/server/trpc.ts` with router and procedure builders
- [ ] Create `src/server/context.ts` (no auth yet, placeholder)
- [ ] Create `src/app/api/trpc/[trpc]/route.ts` handler
- [ ] Create `src/lib/trpc-client.ts` with React Query provider
- [ ] Wire tRPC provider into root layout

**TDD Steps:**
1. Write test: `src/server/routers/session.test.ts` calling `listSessions`
2. Run test → RED (procedure doesn't exist)
3. Create router with mock `listSessions` returning empty array
4. Run test → GREEN
5. Write integration test: API route responds to tRPC request
6. Implement route handler → GREEN

**Acceptance:** `http://localhost:3000/api/trpc/session.list` returns JSON

---

### Task C1.3: Session Reader Library
- [ ] Create `src/lib/session-reader.ts` reading `.harness/sessions/`
- [ ] Implement `listSessions()` with pagination support
- [ ] Implement `getSession(id)` reading manifest.json
- [ ] Implement `getSessionStats(id)` (duration, event count, status)
- [ ] Add Zod schemas in `src/types/session.ts`

**TDD Steps:**
1. Write test: `listSessions()` returns session list from fixture
2. Run test → RED
3. Implement fs.readdir + manifest parsing
4. Run test → GREEN
5. Write test: `getSession()` returns full manifest
6. Implement → GREEN
7. Write test: handles missing/corrupt manifest gracefully
8. Add error handling → GREEN

**Acceptance:** Can read all Phase B sessions from `.harness/sessions/`

---

### Task C1.4: Session List Page
- [ ] Create `src/app/sessions/page.tsx`
- [ ] Create `src/components/sessions/SessionTable.tsx`
- [ ] Implement table with columns: ID, Status, Started, Duration, Budget
- [ ] Add pagination (20 per page)
- [ ] Add status filter dropdown (all/running/completed/aborted)
- [ ] Add search by session ID

**TDD Steps:**
1. Write test: `tests/e2e/session-list.spec.ts` navigates to `/sessions`
2. Run test → RED
3. Create page with "Sessions" heading
4. Run test → GREEN
5. Write test: table displays sessions from tRPC
6. Implement SessionTable + tRPC query → GREEN
7. Write test: pagination buttons work
8. Implement pagination → GREEN
9. Write test: filter by status works
10. Implement filter → GREEN

**Acceptance:** `/sessions` shows table with 20 sessions, pagination, status filter

---

### Task C2.1: Route Reader Library
- [ ] Create `src/lib/route-reader.ts` reading `.harness/routes/`
- [ ] Implement `listRoutes()` with category grouping
- [ ] Implement `getRoute(id)` parsing route definition
- [ ] Implement `getRouteStages(id)` extracting stage tree
- [ ] Add Zod schemas in `src/types/route.ts`

**TDD Steps:**
1. Write test: `listRoutes()` returns routes grouped by category
2. Run test → RED
3. Implement fs.readdir + YAML parsing
4. Run test → GREEN
5. Write test: `getRoute()` returns parsed route with stages
6. Implement → GREEN
7. Write test: handles malformed YAML gracefully
8. Add error handling → GREEN

**Acceptance:** Can read all routes from `.harness/routes/`, parse stages

---

### Task C2.2: Route List Page
- [ ] Create `src/app/routes/page.tsx`
- [ ] Create `src/components/routes/RouteCard.tsx`
- [ ] Display routes grouped by category
- [ ] Show route metadata: name, description, stage count
- [ ] Add search by route name/ID
- [ ] Link to route detail page

**TDD Steps:**
1. Write test: `/routes` displays route cards
2. Run test → RED
3. Create page with RouteCard grid
4. Run test → GREEN
5. Write test: routes grouped by category
6. Implement grouping → GREEN
7. Write test: search filters routes
8. Implement search → GREEN

**Acceptance:** `/routes` shows all routes grouped, searchable, clickable

---

### Task C2.3: Timeline Reader Library
- [ ] Create `src/lib/timeline-reader.ts` reading session timelines
- [ ] Implement `getTimeline(sessionId, { offset, limit })` with streaming
- [ ] Implement `getTimelineStats(sessionId)` (total events, types)
- [ ] Support filtering by event type
- [ ] Add Zod schemas in `src/types/timeline.ts`

**TDD Steps:**
1. Write test: `getTimeline()` returns paginated events
2. Run test → RED
3. Implement JSONL streaming parser
4. Run test → GREEN
5. Write test: handles 10K+ events efficiently
6. Optimize with lazy loading → GREEN
7. Write test: filter by event type works
8. Implement filter → GREEN

**Acceptance:** Can load timeline with 10K+ events in <2s, paginated

---

### Task C2.4: Theme System
- [ ] Install `next-themes` for theme management
- [ ] Create theme provider with system/light/dark modes
- [ ] Add theme toggle in header
- [ ] Configure Tailwind dark mode (class strategy)
- [ ] Style all shadcn/ui components for both themes

**TDD Steps:**
1. Write test: theme toggle changes document class
2. Run test → RED
3. Install next-themes, wrap app in ThemeProvider
4. Run test → GREEN
5. Write test: theme persists in localStorage
6. Verify persistence → GREEN
7. Manual test: all pages render correctly in dark mode

**Acceptance:** Theme toggle works, persists, all UI components styled

---

## Week C3-C4: Core Dashboard (2 weeks)

### Task C3.1: Session Detail Page
- [ ] Create `src/app/sessions/[id]/page.tsx`
- [ ] Create `src/components/sessions/SessionHeader.tsx`
- [ ] Display manifest: ID, status, timestamps, budget
- [ ] Show stage list with completion status
- [ ] Display route information
- [ ] Add breadcrumb navigation
- [ ] Link to timeline page

**TDD Steps:**
1. Write test: `/sessions/[id]` displays session metadata
2. Run test → RED
3. Create page with SessionHeader
4. Run test → GREEN
5. Write test: shows stage list with status badges
6. Implement stage list → GREEN
7. Write test: breadcrumb links work
8. Implement breadcrumb → GREEN

**Acceptance:** `/sessions/{id}` shows full manifest, stage list, nav

---

### Task C3.2: Timeline Virtual Scroll Component
- [ ] Create `src/components/timeline/TimelineVirtualScroll.tsx`
- [ ] Implement virtual scrolling for 1000+ events (react-window)
- [ ] Create `TimelineEvent.tsx` component (styled by type)
- [ ] Add event type icons and color coding
- [ ] Support expand/collapse for nested events
- [ ] Add timestamp formatting

**TDD Steps:**
1. Write test: renders 1000 events without lag
2. Run test → RED
3. Install react-window, implement FixedSizeList
4. Run test → GREEN (verify <100ms render)
5. Write test: event types have correct icons/colors
6. Implement event styling → GREEN
7. Write test: expand/collapse works
8. Implement toggle → GREEN

**Acceptance:** Timeline scrolls smoothly with 10K events, <500ms load

---

### Task C3.3: Timeline Viewer Page
- [ ] Create `src/app/sessions/[id]/timeline/page.tsx`
- [ ] Integrate TimelineVirtualScroll component
- [ ] Add event type filter sidebar
- [ ] Add search within timeline
- [ ] Add jump-to-event navigation
- [ ] Display timeline stats header

**TDD Steps:**
1. Write test: `tests/e2e/timeline.spec.ts` loads timeline page
2. Run test → RED
3. Create page integrating virtual scroll
4. Run test → GREEN
5. Write test: event type filter narrows results
6. Implement filter → GREEN
7. Write test: search highlights matching events
8. Implement search → GREEN

**Acceptance:** `/sessions/{id}/timeline` shows filterable, searchable timeline

---

### Task C4.1: Route Detail Page
- [ ] Create `src/app/routes/[id]/page.tsx`
- [ ] Create `src/components/routes/RouteHeader.tsx`
- [ ] Display route metadata and description
- [ ] Show stage configuration details
- [ ] List route inputs/outputs
- [ ] Add breadcrumb navigation

**TDD Steps:**
1. Write test: `/routes/[id]` displays route details
2. Run test → RED
3. Create page with RouteHeader
4. Run test → GREEN
5. Write test: stage config rendered correctly
6. Implement stage config display → GREEN

**Acceptance:** `/routes/{id}` shows full route definition with stages

---

### Task C4.2: Stage Tree Visualization
- [ ] Create `src/components/routes/StageTree.tsx`
- [ ] Implement tree layout for stage dependencies
- [ ] Add stage status indicators (when viewing in session context)
- [ ] Support collapsible stage groups
- [ ] Add connecting lines between dependent stages

**TDD Steps:**
1. Write test: StageTree renders stage hierarchy
2. Run test → RED
3. Implement recursive tree component
4. Run test → GREEN
5. Write test: dependent stages show connections
6. Implement dependency lines → GREEN
7. Write test: collapse/expand stage groups works
8. Implement toggle → GREEN

**Acceptance:** Stage tree shows hierarchy with dependencies, collapsible

---

### Task C4.3: Budget Visualization
- [ ] Create `src/components/sessions/BudgetPanel.tsx`
- [ ] Display token usage (used/limit) with progress bar
- [ ] Show cost breakdown by stage
- [ ] Add time budget tracking
- [ ] Color-code budget warnings (>80% = yellow, >95% = red)

**TDD Steps:**
1. Write test: BudgetPanel displays usage percentages
2. Run test → RED
3. Implement progress bars with calculations
4. Run test → GREEN
5. Write test: warning colors at thresholds
6. Implement color logic → GREEN

**Acceptance:** Budget panel shows usage, cost breakdown, warning colors

---

## Week C5-C6: Interactive (2 weeks)

### Task C5.1: SSE Manager
- [ ] Create `src/lib/sse-manager.ts` for event broadcasting
- [ ] Create `src/app/api/sse/route.ts` SSE endpoint
- [ ] Implement filesystem watcher for `.harness/sessions/`
- [ ] Broadcast timeline changes to connected clients
- [ ] Handle client connect/disconnect cleanup

**TDD Steps:**
1. Write test: SSE endpoint sends events on file change
2. Run test → RED
3. Implement chokidar watcher + SSE stream
4. Run test → GREEN
5. Write test: multiple clients receive same events
6. Implement broadcast manager → GREEN
7. Write test: disconnected clients cleaned up
8. Implement cleanup → GREEN

**Acceptance:** SSE pushes timeline updates to all clients on file change

---

### Task C5.2: Session Control (CLI Integration)
- [ ] Create `src/server/routers/control.ts` tRPC router
- [ ] Implement `startSession` via child_process spawn
- [ ] Implement `abortSession` (kill process / write abort flag)
- [ ] Implement `pauseSession` / `resumeSession`
- [ ] Add process tracking and status polling
- [ ] Sanitize all CLI arguments (prevent injection)

**TDD Steps:**
1. Write test: `startSession` spawns CLI process
2. Run test → RED
3. Implement child_process.spawn with arg sanitization
4. Run test → GREEN
5. Write test: rejects malicious arguments (injection)
6. Verify sanitization blocks injection → GREEN
7. Write test: `abortSession` terminates process
8. Implement abort → GREEN

**Acceptance:** Can start/abort/pause sessions from UI, CLI injection blocked

---

### Task C5.3: Session Control UI
- [ ] Create `src/components/sessions/SessionControls.tsx`
- [ ] Add Start button with route/input selector modal
- [ ] Add Abort button with confirmation dialog
- [ ] Add Pause/Resume toggle
- [ ] Show live process status indicator
- [ ] Disable controls based on session state

**TDD Steps:**
1. Write test: `tests/e2e/session-control.spec.ts` start flow
2. Run test → RED
3. Implement SessionControls with start modal
4. Run test → GREEN
5. Write test: abort shows confirmation dialog
6. Implement confirmation → GREEN
7. Write test: controls disabled when appropriate
8. Implement state-based disabling → GREEN

**Acceptance:** Start/abort/pause buttons work with confirmations

---

### Task C6.1: Gate Approval System
- [ ] Create `src/lib/gate-watcher.ts` monitoring gate files
- [ ] Create `src/server/routers/gate.ts` tRPC router
- [ ] Implement `listPendingGates(sessionId)` query
- [ ] Implement `approveGate(sessionId, gateId)` mutation
- [ ] Implement `rejectGate(sessionId, gateId, reason)` mutation
- [ ] Broadcast gate events via SSE

**TDD Steps:**
1. Write test: `listPendingGates` returns gates awaiting approval
2. Run test → RED
3. Implement gate file reader
4. Run test → GREEN
5. Write test: `approveGate` writes approval file
6. Implement approval writer → GREEN
7. Write test: gate state broadcast via SSE
8. Implement SSE broadcast → GREEN

**Acceptance:** Can detect pending gates, write approve/reject files

---

### Task C6.2: Gate Approval UI
- [ ] Create `src/components/gates/GatePendingBanner.tsx`
- [ ] Show notification banner when gates pending
- [ ] Create `src/components/gates/GateApprovalModal.tsx`
- [ ] Display gate details: stage, reason, preview
- [ ] Add Approve/Reject buttons with reason textarea
- [ ] Auto-dismiss on approval/rejection

**TDD Steps:**
1. Write test: banner appears when gate pending
2. Run test → RED
3. Implement SSE listener + banner component
4. Run test → GREEN
5. Write test: modal shows gate details
6. Implement GateApprovalModal → GREEN
7. Write test: approve button writes approval
8. Integrate with tRPC mutation → GREEN

**Acceptance:** Gate banner appears, modal shows details, approve/reject work

---

### Task C6.3: Real-Time Timeline Updates
- [ ] Create `src/hooks/useTimelineSSE.ts` hook
- [ ] Subscribe to SSE timeline events
- [ ] Update React Query cache on new events
- [ ] Add visual indicator for new events
- [ ] Auto-scroll to bottom option for live sessions

**TDD Steps:**
1. Write test: timeline updates when SSE event received
2. Run test → RED
3. Implement SSE hook with cache invalidation
4. Run test → GREEN
5. Write test: new event indicator appears
6. Implement visual indicator → GREEN
7. Write test: auto-scroll follows live updates
8. Implement auto-scroll toggle → GREEN

**Acceptance:** Timeline updates in real-time, new events highlighted

---

## Week C7-C8: Polish (2 weeks)

### Task C7.1: Wiki Reader
- [ ] Create `src/lib/wiki-reader.ts` reading `.harness/wiki/`
- [ ] Implement `listWikiPages()` with directory tree
- [ ] Implement `getWikiPage(slug)` parsing markdown
- [ ] Support front matter (title, date, tags)
- [ ] Add full-text search across wiki pages

**TDD Steps:**
1. Write test: `listWikiPages()` returns page tree
2. Run test → RED
3. Implement fs recursion + metadata parsing
4. Run test → GREEN
5. Write test: `getWikiPage()` returns parsed markdown
6. Implement markdown parsing → GREEN
7. Write test: search finds matching pages
8. Implement search indexing → GREEN

**Acceptance:** Can read all wiki pages, parse markdown, search content

---

### Task C7.2: Wiki Browser
- [ ] Create `src/app/wiki/page.tsx` (index/search)
- [ ] Create `src/app/wiki/[...slug]/page.tsx` (article viewer)
- [ ] Install `react-markdown` + syntax highlighting
- [ ] Create `src/components/wiki/WikiSidebar.tsx` (page tree)
- [ ] Add wiki search with result previews
- [ ] Support wiki links between pages

**TDD Steps:**
1. Write test: `/wiki` shows page index
2. Run test → RED
3. Create wiki index page
4. Run test → GREEN
5. Write test: `/wiki/foo/bar` renders markdown
6. Implement article viewer → GREEN
7. Write test: search finds pages by content
8. Implement search UI → GREEN

**Acceptance:** `/wiki` browses pages, search works, markdown renders

---

### Task C7.3: Command Reference
- [ ] Create `src/app/commands/page.tsx`
- [ ] Parse CLI help output for command list
- [ ] Create searchable command reference table
- [ ] Display command syntax, options, examples
- [ ] Link to wiki pages for detailed guides

**TDD Steps:**
1. Write test: `/commands` displays command list
2. Run test → RED
3. Create command parser + reference page
4. Run test → GREEN
5. Write test: search filters commands
6. Implement search → GREEN

**Acceptance:** `/commands` shows searchable CLI reference

---

### Task C8.1: Settings Page
- [ ] Create `src/app/settings/page.tsx`
- [ ] Add theme selector (system/light/dark)
- [ ] Add notification preferences (SSE, desktop)
- [ ] Add session list page size preference
- [ ] Add about section (version, GitHub link)
- [ ] Persist settings in localStorage

**TDD Steps:**
1. Write test: `/settings` renders settings form
2. Run test → RED
3. Create settings page with form
4. Run test → GREEN
5. Write test: settings persist in localStorage
6. Implement persistence → GREEN

**Acceptance:** `/settings` saves preferences, persists across sessions

---

### Task C8.2: Navigation & Layout
- [ ] Create `src/components/layout/Sidebar.tsx`
- [ ] Add navigation links: Sessions, Routes, Wiki, Commands, Settings
- [ ] Add route highlighting for active page
- [ ] Create `src/components/layout/Header.tsx` with breadcrumb
- [ ] Add user menu (theme toggle, settings link)
- [ ] Responsive layout (mobile sidebar collapse)

**TDD Steps:**
1. Write test: sidebar navigation links work
2. Run test → RED
3. Implement Sidebar component
4. Run test → GREEN
5. Write test: active route highlighted
6. Implement highlighting → GREEN
7. Manual test: responsive on mobile

**Acceptance:** Sidebar nav works, active highlighting, mobile responsive

---

### Task C8.3: E2E Test Suite
- [ ] Create `tests/e2e/session-list.spec.ts`
- [ ] Test: Navigate to sessions, filter, paginate
- [ ] Create `tests/e2e/session-detail.spec.ts`
- [ ] Test: View session details, navigate to timeline
- [ ] Create `tests/e2e/timeline.spec.ts`
- [ ] Test: Load timeline, filter events, search
- [ ] Create `tests/e2e/session-control.spec.ts`
- [ ] Test: Start session flow, abort with confirmation
- [ ] Create `tests/e2e/gate-approval.spec.ts`
- [ ] Test: Pending gate banner, approve/reject flow

**TDD Steps:**
1. Install Playwright, configure test setup
2. Write session list test suite → verify all pass
3. Write session detail test suite → verify all pass
4. Write timeline test suite → verify all pass
5. Write session control test suite → verify all pass
6. Write gate approval test suite → verify all pass
7. Add CI workflow to run E2E tests

**Acceptance:** All E2E tests pass, CI runs tests on PR

---

### Task C8.4: Performance Optimization
- [ ] Add React Query stale time configuration
- [ ] Implement optimistic updates for mutations
- [ ] Add loading skeletons for data fetching
- [ ] Optimize timeline virtual scroll performance
- [ ] Add error boundaries for graceful failures
- [ ] Measure and optimize First Contentful Paint (FCP)

**TDD Steps:**
1. Measure baseline: Lighthouse performance score
2. Add loading skeletons → re-measure
3. Optimize React Query caching → re-measure
4. Profile timeline rendering, optimize → re-measure
5. Target: FCP <1.5s, LCP <2.5s, Performance score >90

**Acceptance:** Lighthouse score >90, FCP <1.5s, no layout shifts

---

### Task C8.5: Error Handling & Edge Cases
- [ ] Add error boundaries with retry buttons
- [ ] Handle missing session files gracefully
- [ ] Handle corrupt JSON/JSONL gracefully
- [ ] Add "No sessions found" empty state
- [ ] Add "Session not found" 404 page
- [ ] Toast notifications for errors

**TDD Steps:**
1. Write test: corrupt manifest shows error UI
2. Run test → RED
3. Implement error boundary → GREEN
4. Write test: missing session shows 404
5. Implement 404 page → GREEN
6. Write test: mutation errors show toast
7. Implement toast notifications → GREEN

**Acceptance:** All error cases handled with user-friendly messages

---

## Cross-Cutting Concerns

### Authentication (Placeholder)
- Basic auth skeleton in `src/server/context.ts`
- No actual auth in Phase C (single-user localhost)
- Prepared for Phase D multi-user deployment

### Security
- [ ] Sanitize all CLI arguments (prevent injection)
- [ ] Validate all file paths (prevent traversal)
- [ ] CSP headers configured
- [ ] No sensitive data in client bundles

### Accessibility
- [ ] All interactive elements keyboard navigable
- [ ] ARIA labels on buttons and links
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader tested on key flows

### Documentation
- [ ] README with setup instructions
- [ ] Architecture decision record (ADR) for tech choices
- [ ] Deployment guide (localhost + production)
- [ ] API documentation (tRPC procedures)

---

## Acceptance Criteria

### Week C1-C2
- [ ] App runs on localhost:3000
- [ ] Theme toggle works (light/dark)
- [ ] tRPC listSessions returns data
- [ ] Session list page shows 20 sessions with pagination
- [ ] Route list page shows all routes grouped by category

### Week C3-C4
- [ ] Session detail page shows manifest + stages
- [ ] Timeline page renders 10K+ events smoothly
- [ ] Event type filter and search work
- [ ] Route detail page shows stage tree
- [ ] Budget panel displays usage and warnings

### Week C5-C6
- [ ] SSE pushes timeline updates in real-time
- [ ] Start session button spawns CLI process
- [ ] Abort button terminates session with confirmation
- [ ] Gate approval banner appears on pending gates
- [ ] Approve/reject writes gate files

### Week C7-C8
- [ ] Wiki browser renders markdown with syntax highlighting
- [ ] Command reference searchable and complete
- [ ] Settings page persists preferences
- [ ] All E2E tests pass in CI
- [ ] Lighthouse performance score >90

---

## Task Summary

**Total Tasks:** 30
**Total TDD Steps:** ~150
**Key Pages:** 
- `/sessions` — session list with filters
- `/sessions/[id]` — session detail with manifest
- `/sessions/[id]/timeline` — virtual scrolled timeline
- `/routes` — route list grouped by category
- `/routes/[id]` — route detail with stage tree
- `/wiki` — wiki browser with search
- `/commands` — CLI command reference
- `/settings` — user preferences

**Tech Stack:**
- Frontend: Next.js 14, React 18, TypeScript, Tailwind, shadcn/ui
- API: tRPC 10, Zod, React Query
- Real-time: Server-Sent Events (SSE)
- Testing: Playwright (E2E), Vitest (unit)
- Performance: react-window (virtual scroll), optimistic updates

**Parallel Execution:** Can run alongside Phase B Beta testing

---

## Risk Mitigation

**High Risk:**
- Timeline performance with 10K+ events → Mitigate with virtual scroll (react-window)
- SSE connection stability → Mitigate with auto-reconnect + error handling
- CLI injection attacks → Mitigate with strict argument sanitization

**Medium Risk:**
- Real-time update race conditions → Mitigate with React Query cache invalidation
- File watching on Windows → Mitigate with chokidar cross-platform support

**Low Risk:**
- Theme system complexity → Mitigate with next-themes library
- Mobile responsiveness → Mitigate with Tailwind responsive utilities

---

## Future Enhancements (Post-Phase C)

- Multi-user authentication (Phase D)
- Session comparison view (diff two timelines)
- Export timeline as JSON/CSV
- Custom dashboard widgets
- WebSocket for bidirectional control
- Session replay with step-through
- Advanced analytics (token usage trends, route performance)


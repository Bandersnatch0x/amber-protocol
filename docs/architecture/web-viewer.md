# Web Viewer Architecture

## Overview

The web viewer is a Next.js-based dashboard for visualizing Amber Protocol sessions,
routes, timelines, and wiki documentation. It is a **supervised action viewer** —
read-only dashboards combined with a constrained set of audited, non-arbitrary
mutations (session start/pause/resume/abort and verification command execution).

See [ADR-0007](../adr/0007-web-viewer-role.md) for the formal boundary between
allowed web actions and CLI-only actions.

**Status:** Scaffold with server-side session control and verification. UI
components partially implemented.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Runtime:** React 18
- **Language:** TypeScript (strict mode)
- **API Layer:** tRPC 10 + Zod validation
- **Backend:** Express 5 + tRPC
- **UI Components:** Tailwind CSS + shadcn/ui + Radix UI primitives
- **State Management:** TanStack Query (server state) + Zustand (client state)
- **Real-time:** Server-Sent Events (SSE)
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Dev Tools:** ESLint, Prettier, Husky pre-commit hooks

## Architecture Principles

1. **Supervised Action Viewer:** Web viewer reads `.amber/` filesystem. It may
   write to `timeline.jsonl`, `ledger.jsonl`, and `manifest.json` for session
   control and verification — see [ADR-0007](../adr/0007-web-viewer-role.md) for
   the complete allow list. It never creates/deletes files or modifies
   `feature_list.json`.
2. **No Database:** All data comes from filesystem state (manifest.json, timeline.jsonl)
3. **Real-Time Updates:** SSE streams filesystem changes to connected clients
4. **Stateless Server:** tRPC procedures are pure functions reading current state
5. **Local-First:** Runs on `localhost`, no external hosting or authentication
6. **Offline-Capable:** Works without internet connection

## Project Structure

```
apps/web/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout + theme provider
│   │   ├── page.tsx            # Dashboard home
│   │   ├── sessions/           # Session listing and detail
│   │   ├── routes/             # Route browser
│   │   ├── wiki/               # Wiki viewer
│   │   ├── settings/           # Settings panel
│   │   └── api/                # API routes
│   │       ├── trpc/[trpc]/    # tRPC handler
│   │       └── sse/            # SSE endpoint
│   ├── components/
│   │   ├── ui/                 # shadcn/ui base components
│   │   ├── sessions/           # Session-specific components
│   │   ├── routes/             # Route-specific components
│   │   ├── timeline/           # Timeline visualization
│   │   ├── wiki/               # Wiki renderer
│   │   └── layout/             # Layout components (nav, header)
│   ├── server/
│   │   ├── trpc.ts             # tRPC router setup
│   │   ├── context.ts          # Request context
│   │   └── routers/            # tRPC procedure routers
│   │       ├── session.ts      # Session operations
│   │       ├── route.ts        # Route operations
│   │       ├── timeline.ts     # Timeline operations
│   │       └── wiki.ts         # Wiki operations
│   ├── lib/
│   │   ├── session-reader.ts   # Read session manifests
│   │   ├── route-reader.ts     # Read route definitions
│   │   ├── timeline-reader.ts  # Stream timeline events
│   │   ├── wiki-reader.ts      # Parse wiki markdown
│   │   └── sse-manager.ts      # SSE connection manager
│   └── types/
│       ├── session.ts          # Zod schemas for sessions
│       ├── route.ts            # Zod schemas for routes
│       └── timeline.ts         # Zod schemas for timeline events
├── tests/
│   ├── unit/                   # Vitest unit tests
│   └── e2e/                    # Playwright E2E tests
├── package.json
└── README.md
```

## Core Components

### 1. tRPC API Layer

**Purpose:** Type-safe API between frontend and filesystem.

**Routers:**

#### Session Router (`server/routers/session.ts`)
```typescript
listSessions({ filter?, page?, pageSize? }) → Session[]
getSession(sessionId) → SessionDetail
getSessionStats(sessionId) → SessionStats
controlSession(sessionId, action) → ControlResult
```

#### Route Router (`server/routers/route.ts`)
```typescript
listRoutes() → Route[]
getRoute(routeId) → RouteDetail
getRouteStages(routeId) → Stage[]
```

#### Timeline Router (`server/routers/timeline.ts`)
```typescript
getTimeline(sessionId, { offset, limit, eventTypes? }) → TimelineEvent[]
getTimelineStats(sessionId) → TimelineStats
```

#### Wiki Router (`server/routers/wiki.ts`)
```typescript
getWikiIndex() → WikiNode[]
getWikiPage(path) → WikiPage
searchWiki(query) → SearchResult[]
```

**Design:**
- All procedures read filesystem directly (no caching layer)
- Zod schemas validate input and output
- Error handling returns typed errors to client
- Procedures are stateless and pure

### 2. Filesystem Readers

#### Session Reader (`lib/session-reader.ts`)

**Purpose:** Read session manifests from `.amber/sessions/`.

**Functions:**

- **`listSessions(filter)`**
  - Scans `.amber/sessions/` directory
  - Reads manifest.json for each session
  - Filters by state (active/completed/failed)
  - Returns sorted list (newest first)

- **`getSession(sessionId)`**
  - Reads `manifest.json`
  - Validates against Zod schema
  - Returns full session detail

- **`getSessionStats(sessionId)`**
  - Calculates duration, event count, token usage
  - Returns aggregated metrics

**Error Handling:**
- Missing manifest → null return
- Corrupt JSON → validation error
- Missing sessions directory → empty list

#### Timeline Reader (`lib/timeline-reader.ts`)

**Purpose:** Stream and parse timeline.jsonl files.

**Functions:**

- **`getTimeline(sessionId, options)`**
  - Streams JSONL file line-by-line
  - Supports offset/limit pagination
  - Filters by event type
  - Handles large files (10K+ events)

- **`getTimelineStats(sessionId)`**
  - Counts total events
  - Groups by event type
  - Returns summary statistics

**Performance:**
- Lazy loading (don't load entire file into memory)
- Stream parsing for large timelines
- Client-side pagination support

#### Route Reader (`lib/route-reader.ts`)

**Purpose:** Read route definitions from `routes/`.

**Functions:**

- **`listRoutes()`**
  - Scans `routes/*.route.json`
  - Validates each route
  - Returns sorted list

- **`getRoute(routeId)`**
  - Reads route definition
  - Parses stages and gates
  - Returns full route detail

- **`getRouteStages(routeId)`**
  - Extracts stage tree
  - Resolves gate references
  - Returns executable plan

#### Wiki Reader (`lib/wiki-reader.ts`)

**Purpose:** Parse and serve wiki documentation.

**Functions:**

- **`getWikiIndex()`**
  - Reads `docs/wiki/index.md`
  - Parses navigation tree
  - Returns hierarchical structure

- **`getWikiPage(path)`**
  - Reads markdown file
  - Parses frontmatter (if present)
  - Returns HTML + metadata

- **`searchWiki(query)`**
  - Full-text search across wiki pages
  - Returns matching pages with highlights

### 3. Real-Time Updates (SSE)

#### SSE Manager (`lib/sse-manager.ts`)

**Purpose:** Stream filesystem changes to connected clients.

**Events:**

- `session_created` - New session started
- `session_updated` - Session state changed
- `session_completed` - Session finished
- `timeline_event` - New timeline event added

**Implementation:**
- Server-Sent Events (SSE) API
- Filesystem watcher (chokidar or fs.watch)
- Connection pooling per client
- Automatic reconnection on client

**Endpoint:**
```
GET /api/sse?sessionId=<id>
```

**Event Stream:**
```
event: session_updated
data: {"sessionId":"abc-123","state":"executing","stage":"implement"}

event: timeline_event
data: {"type":"stage_completed","stage":"verify","timestamp":"2026-06-21T10:00:00Z"}
```

### 4. UI Components

#### Session Components

- **SessionTable** - Paginated list of sessions
- **SessionDetail** - Full session view with stages
- **SessionControls** - Play/pause/abort buttons
- **SessionMetrics** - Token usage, duration, progress bar

#### Timeline Components

- **TimelineView** - Chronological event list
- **TimelineFilter** - Event type filter dropdown
- **EventCard** - Individual event display
- **TimelineChart** - Visual timeline graph

#### Route Components

- **RouteGrid** - Route cards by category
- **RouteDetail** - Full route definition view
- **StageTree** - Visual stage hierarchy
- **GateMarker** - Gate checkpoint indicators

#### Wiki Components

- **WikiNav** - Tree navigation sidebar
- **WikiPage** - Markdown renderer with syntax highlighting
- **WikiSearch** - Search input with live results

### 5. State Management

#### Server State (TanStack Query)

- Handles all API calls via tRPC
- Automatic caching and revalidation
- Optimistic updates for session controls
- Background refetching

#### Client State (Zustand)

- UI state (sidebar open/closed, theme)
- Filter settings (session filter, timeline filter)
- Pagination state
- User preferences

### 6. Theme System

**next-themes** integration:

- System/light/dark mode support
- Persists to localStorage
- SSR-compatible (no flash)
- Tailwind dark mode classes

**Theme Toggle:**
- Header button switches themes
- Icon changes (sun/moon)
- Transitions smoothly

## Page Routes

```
/                           # Dashboard home (overview)
/sessions                   # Session list
/sessions/:id               # Session detail
/sessions/:id/timeline      # Full timeline view
/routes                     # Route browser
/routes/:id                 # Route detail
/wiki                       # Wiki index
/wiki/:path                 # Wiki page
/settings                   # Settings panel
```

## API Endpoints

```
/api/trpc/[trpc]           # tRPC HTTP handler
/api/sse                   # Server-Sent Events stream
```

## Data Flow

```
Filesystem (.amber/)
    ↓
Readers (session-reader, timeline-reader, etc.)
    ↓
tRPC Routers (server/routers/)
    ↓
tRPC Client (TanStack Query)
    ↓
React Components
    ↓
User Interface
```

**Real-Time Updates:**
```
Filesystem Change
    ↓
fs.watch / chokidar
    ↓
SSE Manager
    ↓
Event Stream
    ↓
Client EventSource
    ↓
Query Invalidation
    ↓
UI Update
```

## Testing Strategy

### Unit Tests (Vitest)

- Reader functions (session-reader, timeline-reader)
- tRPC procedures
- Utility functions
- Component logic

### E2E Tests (Playwright)

- Session list page
- Session detail page
- Timeline view
- Route browser
- Wiki navigation
- Session controls
- Real-time updates

### Test Fixtures

```
tests/fixtures/
├── sessions/              # Sample session manifests
├── routes/                # Sample route definitions
├── timelines/             # Sample timeline.jsonl files
└── wiki/                  # Sample wiki pages
```

## Development Commands

```bash
cd apps/web

# Development
npm run dev              # Start dev server (client + backend)
npm run dev:client       # Vite dev server only
npm run dev:server       # Express + tRPC server only

# Build
npm run build            # Production build
npm run start            # Start production server

# Testing
npm test                 # Run Vitest tests
npm run test:e2e         # Run Playwright tests
npm run test:watch       # Watch mode

# Linting
npm run lint             # ESLint
npm run format           # Prettier
```

## Configuration Files

```
apps/web/
├── next.config.mjs         # Next.js configuration
├── tailwind.config.ts      # Tailwind CSS configuration
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Vitest configuration
├── playwright.config.ts    # Playwright configuration
├── .eslintrc.json          # ESLint configuration
└── .prettierrc             # Prettier configuration
```

## Security Considerations

1. **Local-Only:** Server binds to localhost only (no external access)
2. **No Authentication:** Assumes single-user local development environment
3. **Audited Mutations Only:** Web viewer writes only to `timeline.jsonl`,
   `ledger.jsonl`, and `manifest.json` — all appended, never overridden. See
   [ADR-0007](../adr/0007-web-viewer-role.md) for the allowed mutation list.
4. **Input Validation:** All API inputs validated via Zod schemas
5. **Path Traversal:** Filesystem reads restricted to `.amber/` directory

## Performance Targets

- Page load: < 1s
- API response: < 200ms
- Timeline (1000 events): < 2s
- Real-time latency: < 100ms
- Memory usage: < 100MB

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- No IE11 support

## Future Enhancements

- Session replay (step through timeline)
- Route visualization (graph view)
- Export reports (PDF/CSV)
- Custom dashboards
- Multi-project support
- Session comparison
- Metrics charting

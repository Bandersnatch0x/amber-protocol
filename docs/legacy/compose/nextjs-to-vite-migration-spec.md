# Next.js to Vite + TanStack Router Migration Specification

## [S1] Problem Statement

The current web application is built on Next.js 14 with App Router. That stack works, but it is heavier than needed for a local session viewer whose primary job is to read local files from `.amber/sessions`, render client-side views, and keep a live SSE connection open.

The migration should reduce local startup and iteration cost without regressing existing product behavior.

Current pain points:

1. Slow cold start for local development compared with a Vite client.
2. Next.js server rendering features are unused for the primary workflow.
3. The current frontend routing is tied to the App Router file layout, which makes client-only route composition harder than necessary.
4. The current app already contains working domain logic for sessions, gates, routes, tRPC, and SSE; the migration should preserve that logic instead of replacing it with a parallel implementation.

## [S2] Solution Overview

Migrate the frontend shell from Next.js App Router to Vite + React + TanStack Router, while preserving the existing backend domain logic and exposing it through a lightweight standalone Node server for local development.

Target architecture:

- Frontend: Vite + React 18 + TanStack Router
- Data fetching: existing TanStack Query + tRPC client
- Backend API: existing tRPC routers served by a lightweight Express host
- Real-time updates: existing SSE event pipeline served by the standalone backend
- Data source: local file system under `.amber/sessions` and `routes`
- State management: existing client hooks and local component state (there is no global store today; `zustand` is an unused dependency and should be removed during cleanup)

This is a migration of the web shell and runtime wiring, not a rewrite of session, route, gate, or event business logic.

## [S3] Functional Requirements

### [S3.1] Session Management

- Display the session list with status, goal, route, and created timestamp.
- Display session details including budget, worktree state, manifest, and timeline event count.
- Display timeline events with filtering and virtualized rendering.
- Preserve session control operations: start, pause, resume, and abort.

### [S3.2] Route Management

- Display grouped routes.
- Support existing route search/filter behavior.
- Display route details.

### [S3.3] Gate Management

- Display the gate list.
- Support existing gate status filtering behavior.
- Preserve gate read and decision APIs already implemented on the backend.

### [S3.4] Real-time Updates

- Keep the SSE connection for live session events.
- Preserve reconnection behavior with bounded retry/backoff.
- Preserve status derivation from live events for session-related UI.

### [S3.5] Theme Support

- Preserve dark/light mode toggle.
- Persist theme preference across reloads.

## [S4] Non-Functional Requirements

### [S4.1] Performance

- Local client cold start should improve materially versus Next.js dev mode.
- HMR should remain fast and predictable during page work.
- The migration should avoid duplicating filesystem readers, routers, or event services.

### [S4.2] Development Experience

- Use TanStack Router for type-safe client routing.
- Keep type-safe API contracts through tRPC + Zod.
- Use Vite-native environment access on the client (`import.meta.env`), not Next-specific patterns.
- Keep a clear separation between client code and server-only filesystem code.

### [S4.3] Compatibility

- Node.js 18+
- Modern desktop browsers used locally for development and testing

## [S5] Technical Constraints

### [S5.1] Data Sources

- Sessions are stored in `.amber/sessions/{sessionId}/manifest.json`.
- Timeline events are stored in `.amber/sessions/{sessionId}/timeline.jsonl`.
- Gate files are stored in `.amber/sessions/{sessionId}/gates/{gateId}.gate.json`.
- Gate decisions are stored in `.amber/sessions/{sessionId}/gates/{gateId}.decision.json`.
- Route definitions are stored in `routes/*.route.json`.

### [S5.2] API Design

- Preserve tRPC for query and mutation APIs rather than replacing it with ad hoc REST endpoints.
- Preserve SSE at `/api/sessions/:sessionId/events`.
- The standalone backend should expose:
  - `/api/trpc`
  - `/api/sessions/:sessionId/events`
  - `/api/health`
- Client development should use a Vite proxy to the local backend.

### [S5.3] Code Organization

- Client-only code must live under `apps/web/src`.
- Server-only code must not be imported into browser runtime modules.
- Existing filesystem readers, routers, and SSE services should be moved or re-exported into stable server-only locations instead of being duplicated.
- The current `appRouter` export should be separated from the server bootstrap so the client can keep importing the router type without importing server startup code.

Recommended target structure:

```text
apps/web/
  src/
    main.tsx
    router.tsx
    routeTree.gen.ts
    routes/
      __root.tsx
      index.tsx
      sessions.tsx
      sessions.$id.tsx
      sessions.$id.timeline.tsx
      routes.tsx
      routes.$id.tsx
      gates.tsx
      settings.tsx
    components/
    lib/
      trpc.ts
      trpc-provider.tsx
      theme-provider.tsx
      hooks/
        useSessionEvents.ts
      types/
    test/
      setup.ts
    index.css
  server/
    app-router.ts
    index.ts
    trpc.ts
    routers/
    routes/
      sse.ts
    services/
    lib/
      session-reader.ts
      route-reader.ts
      gate-reader.ts
  package.json
  vite.config.ts
  tsconfig.json
  tsconfig.node.json
  tailwind.config.js
  postcss.config.js
  vitest.config.ts
  playwright.config.ts
  index.html
```

## [S6] Success Criteria

### [S6.1] Functional Success

- All current pages still work after the migration.
- Session controls continue to function.
- tRPC queries and mutations continue to return correct data.
- SSE continues to stream and reconnect correctly.
- Theme toggle still works.

### [S6.2] Performance Success

- Local client startup is noticeably faster than the current Next.js flow. Record the current `next dev` cold-start time before migration as the comparison baseline.
- The migration does not add a second parallel backend implementation.
- Build and test workflows remain usable from the local repo.

### [S6.3] Quality Success

- No TypeScript errors in the migrated app.
- No obvious console/runtime errors in normal flows.
- Existing Vitest and Playwright coverage passes after the migration is complete.
- Code follows consistent client/server boundaries.

## [S7] Out of Scope

- Adding new product features beyond parity with the current app
- Changing session status rules or gate decision semantics
- Redesigning the `.amber` or `routes` file formats
- Production deployment hardening beyond what is needed for local development

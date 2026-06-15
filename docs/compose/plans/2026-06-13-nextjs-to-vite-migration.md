# Next.js to Vite + TanStack Router Migration Plan

**Goal:** migrate the `apps/web` frontend from Next.js App Router to Vite + TanStack Router while preserving existing tRPC, SSE, session control, route, and gate behavior.

**Architecture direction:** replace the Next.js page shell with a Vite client, keep the existing backend domain logic, and host that backend through a lightweight standalone Express server.

**Tech stack:** Vite 5, React 18, TanStack Router, TanStack Query 5, tRPC 10 (`createExpressMiddleware`), Express 4, `tsx` for the server process, `concurrently` for the combined dev script.

**Spec:** `docs/compose/specs/2026-06-13-nextjs-to-vite-migration.md`

---

## Migration Principles

- Preserve behavior before optimizing structure.
- Reuse existing readers, routers, services, and tests instead of reimplementing them.
- Keep server-only filesystem code out of `src/`.
- Do not stub session control; migrate it intact.
- Do not delete `apps/web/server/`; convert it into the standalone backend host.
- Do not flip the `@/*` alias until client files actually move (Task 4) — flipping it earlier breaks every existing import under `app/`, `components/`, and `lib/`.

---

## Verified Codebase Facts (plan assumptions checked against code)

These were confirmed by inspection; the plan depends on them:

- `server/index.ts` is currently **only** the 14-line `appRouter` composition — there is no server bootstrap yet. The Next route handlers (`app/api/trpc/[trpc]/route.ts`, `app/api/sessions/[sessionId]/events/route.ts`) are the current runtime bridge.
- `server/routes/sse.ts` is already written against Express `Request`/`Response` types; the Next handler wraps it in a mock adapter. Moving to real Express **removes** the adapter rather than adding one.
- `useSessionEvents` (`lib/hooks/useSessionEvents.ts`) returns exactly `{ status, connectionState, lastEvent, error, events }`, filters heartbeats at line 50, and uses bounded exponential backoff capped at 10s.
- Session control (`server/routers/session-control.ts`) is an in-memory state machine that emits SSE events; it does not spawn processes or write manifests. A single Express process shares the `eventBroadcaster`/`sessionEvents` singletons correctly.
- `lib/session-reader.ts:31` resolves `.amber/sessions` via `path.join(process.cwd(), '..', '..')` — **the server process must start with `cwd = apps/web`** (the npm scripts below guarantee this).
- `lib/trpc.ts:12-13` reads `process.env.VERCEL_URL` and `process.env.PORT` — these crash in a Vite browser bundle (`process` is undefined) and must be removed in Task 3.
- `lib/auth-token.ts` is dead code (never imported anywhere). `zustand`, `react-window`, `@types/react-window` are unused dependencies. `hooks/` and `types/` are empty directories. The `@lib/*`, `@components/*`, `@types/*` aliases have zero usages.
- Client tests import via `@/lib/...` and `@/components/...`; server tests import via `@/server/...` (`tests/server/*.test.ts`, `tests/real-time-session.test.ts`). The alias flip in Task 4 keeps client test imports working (same relative shape under `src/`) but **breaks server test imports**, which must move to `@server/*`.

---

## Next API → Vite/TanStack Replacement Map

Every Next-specific API in client code, with its exact replacement. This is the bulk of the mechanical work in Task 4.

| Next API | Where (exact files) | Replacement |
|---|---|---|
| `<Link href="...">` from `next/link` | `app/page.tsx`, `app/sessions/page.tsx`, `app/sessions/[id]/page.tsx`, `app/sessions/[id]/timeline/page.tsx`, `app/routes/page.tsx`, `app/routes/[id]/page.tsx` | `<Link to="...">` from `@tanstack/react-router`; dynamic segments become `to="/sessions/$id" params={{ id: session.id }}` instead of template strings |
| `useParams()` from `next/navigation` | `app/sessions/[id]/page.tsx:26`, `app/routes/[id]/page.tsx:8`, `app/sessions/[id]/timeline/page.tsx:74` | `const { id } = Route.useParams()` from the owning route file |
| `Inter` from `next/font/google` | `app/layout.tsx:3` | `<link>` tag for the Inter font in `index.html` plus `font-family` in `src/index.css` (or drop to system font stack) |
| `'use client'` directive | all pages, components, hooks, providers | delete — it is a no-op outside Next and only adds noise |
| `suppressHydrationWarning` on `<html>` | `app/layout.tsx:22` | not needed — there is no SSR; `next-themes` works in plain React (verified: `lib/theme-provider.tsx` is a thin wrapper) |
| `process.env.*` in browser code | `lib/trpc.ts:12-13` | `import.meta.env.VITE_API_URL ?? ''` (same-origin via Vite proxy by default) |

`next-themes` stays — it works without Next and preserving it avoids re-testing theme persistence.

---

## Task Dependency Graph

```text
Task 1 (Tooling Setup)
  -> Task 2 (Backend Extraction and Standalone Host)
  -> Task 3 (Client Shell)          [imports `type AppRouter` from server/app-router.ts created in Task 2]
  -> Task 4 (Page Migration + Alias Flip)
  -> Task 5 (Testing, Cleanup, and Cutover)
```

**Execution order:** strictly serial, Task 1 → 5. Task 3 depends on Task 2 because the client tRPC setup imports `type AppRouter` from `@server/app-router`, which Task 2 creates.

---

## Task 1: Tooling Setup

**Covers:** S4.2, S5.3

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/index.html`

- [ ] Add dev/runtime dependencies: `vite`, `@tanstack/react-router`, `@tanstack/router-plugin`, `@tanstack/router-devtools`, `tsx`, `concurrently`, `express`, `@types/express`. Do **not** add `cors` — the Vite proxy makes all requests same-origin (add it later only if a cross-origin `VITE_API_URL` deployment appears).
- [ ] Keep existing tRPC, TanStack Query, Zod, superjson, next-themes, and SSE-related dependencies.
- [ ] Replace the Next scripts in `package.json`:

```json
"scripts": {
  "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
  "dev:client": "vite",
  "dev:server": "tsx watch server/index.ts",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

  (`next lint` is dropped here; the lint replacement is handled with the rest of the Next removal in Task 5.)

  Note: `dev:server` runs with `cwd = apps/web`, which `lib/session-reader.ts:31` requires to find `.amber/sessions`. Never start the server from the repo root.

- [ ] Create `apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'path';

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <title>Amber Protocol - Web Viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] Update `tsconfig.json`: remove the `"plugins": [{ "name": "next" }]` block and the `next-env.d.ts` / `.next/types/**` entries from `include`. **Keep `@/*` mapped to `./*` for now** — the flip to `src/*` happens in Task 4 when client files move. Keep `@server/*` → `./server/*`. Remove the unused `@lib/*`, `@components/*`, `@types/*` aliases (zero usages, verified).
- [ ] Create `tsconfig.node.json` for `vite.config.ts` and the server (node types, `module: esnext`, `moduleResolution: bundler`), and reference it from `tsconfig.json`.
- [ ] Leave `vitest.config.ts` untouched in this task — it already excludes `tests/e2e/**`, and its aliases still match the not-yet-flipped tsconfig.

**Verification**

- [ ] `npm install` completes without errors
- [ ] `npx vite --version` prints a 5.x version
- [ ] `npm run test` still passes (nothing moved yet; tooling additions must not break the existing suite)
- [ ] Commit: `chore(web): add vite toolchain alongside next`

---

## Task 2: Extract the Backend from Next Route Handlers

**Covers:** S3.1, S3.3, S3.4, S5.1, S5.2, S5.3

**Files:**

- Create: `apps/web/server/app-router.ts`
- Modify: `apps/web/server/index.ts` (becomes the Express bootstrap)
- Move: `apps/web/lib/session-reader.ts` → `apps/web/server/lib/session-reader.ts`
- Move: `apps/web/lib/route-reader.ts` → `apps/web/server/lib/route-reader.ts`
- Move: `apps/web/lib/gate-reader.ts` → `apps/web/server/lib/gate-reader.ts`
- Modify: `apps/web/server/routers/session.ts`, `route.ts`, `gate.ts`, `session-control.ts` (reader import paths only)
- Modify: `apps/web/server/routes/sse.ts` (reader import path only)
- Modify: `apps/web/lib/trpc.ts` (type import only), `apps/web/tests/server/*.test.ts`, `apps/web/tests/real-time-session.test.ts` (alias updates)

- [ ] Create `server/app-router.ts` with the current contents of `server/index.ts`, verbatim:

```ts
import { router } from './trpc';
import { sessionRouter } from './routers/session';
import { routeRouter } from './routers/route';
import { sessionControlRouter } from './routers/session-control';
import { gateRouter } from './routers/gate';

export const appRouter = router({
  session: sessionRouter,
  route: routeRouter,
  sessionControl: sessionControlRouter,
  gate: gateRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] Replace `server/index.ts` with the standalone Express bootstrap. Use `createExpressMiddleware` from `@trpc/server/adapters/express` (available in tRPC 10.45; do not use `fetchRequestHandler` — that was only needed for the Next fetch runtime):

```ts
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './app-router';
import { handleSSE } from './routes/sse';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(
  '/api/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: () => ({}),
  })
);

app.get('/api/sessions/:sessionId/events', handleSSE);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
```

- [ ] Move the three filesystem readers from `lib/` to `server/lib/` unchanged. Update their importers from `@/lib/session-reader` (etc.) to relative paths (`../lib/session-reader` from `server/routers/`, `../lib/session-reader` from `server/routes/`). After this step no module under `server/` imports through `@/`.
- [ ] Update the client type import in `lib/trpc.ts:5` from `@/server/index` to `@server/app-router` (`import type { AppRouter } from '@server/app-router'`). Type-only — no runtime impact.
- [ ] Update server-side test imports from `@/server/...` to `@server/...`: `tests/server/event-broadcaster.test.ts`, `tests/server/session-control.test.ts`, `tests/server/session-events.test.ts`, `tests/real-time-session.test.ts`. (`tests/event-store.test.ts` uses relative imports and is unaffected.) This must happen now, not in Task 5 — after the Task 4 alias flip, `@/server/...` resolves to a nonexistent `src/server/`.
- [ ] Do not modify `server/routes/sse.ts` logic, `server/services/*`, or any router procedure — reuse them as-is. The SSE handler already has Express signatures.
- [ ] Preserve the current session control mutations and event emission behavior (state machine in `session-control.ts` is untouched).

**Verification**

- [ ] `npm run test` passes (server tests now via `@server/*`)
- [ ] `npm run dev:server` starts and logs the listen line
- [ ] `curl http://localhost:3001/api/health` → `{"ok":true}`
- [ ] `curl "http://localhost:3001/api/trpc/session.list?batch=1&input=%7B%7D"` returns a tRPC envelope (superjson-wrapped session array)
- [ ] `curl -N http://localhost:3001/api/sessions/<existing-id>/events` opens an SSE stream and replays historical events
- [ ] The Next app still runs (`npx next dev`) — the bridge route handlers still import what they need; full removal happens in Task 5
- [ ] Commit: `feat(web): standalone express host for trpc and sse`

---

## Task 3: Build the Vite Client Shell

**Covers:** S2, S3.5, S4.2, S5.3

**Files:**

- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/routes/__root.tsx`
- Create: `apps/web/src/routes/index.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/lib/trpc.ts`
- Create: `apps/web/src/lib/trpc-provider.tsx`

- [ ] Create `src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
```

- [ ] Create `src/router.tsx`:

```tsx
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] Create `src/lib/trpc.ts` — port of `lib/trpc.ts` with the browser-unsafe `getBaseUrl` removed (the old `process.env.VERCEL_URL` / `process.env.PORT` branches at `lib/trpc.ts:12-13` crash under Vite):

```ts
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@server/app-router';
import superjson from 'superjson';

export const trpc = createTRPCReact<AppRouter>();

// Same-origin via the Vite dev proxy by default; VITE_API_URL overrides for non-default hosts.
function getBaseUrl() {
  return import.meta.env.VITE_API_URL ?? '';
}

export function getTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
        transformer: superjson,
      }),
    ],
  });
}
```

- [ ] Copy `lib/trpc-provider.tsx` to `src/lib/trpc-provider.tsx` unchanged except: drop the `'use client'` line, import from `./trpc`. Preserve the existing QueryClient defaults (staleTime 5 min, cacheTime 10 min, no refetch on focus, retry 1).
- [ ] Create `src/routes/__root.tsx` by porting `app/layout.tsx`: copy the nav markup from `app/layout.tsx:26-72` verbatim, replace the four `<a href>` nav links with TanStack `<Link to>` (they get active-state support for free), render `<Outlet />` where `{children}` was, and keep `ThemeProvider`, `TRPCProvider`, `ThemeToggle`, `ErrorBoundary` in the same nesting order:

```tsx
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider } from '@/lib/theme-provider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  return (
    <ThemeProvider>
      <TRPCProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          {/* nav ported verbatim from app/layout.tsx:26-72, <a href> → <Link to> */}
          <ErrorBoundary>
            <main>
              <Outlet />
            </main>
          </ErrorBoundary>
        </div>
      </TRPCProvider>
    </ThemeProvider>
  );
}
```

  Note: until Task 4 moves `theme-provider`, `ThemeToggle`, and `ErrorBoundary` into `src/`, these `@/` imports resolve against the root-level files via the unflipped tsconfig alias — Vite's own alias points at `src/`, so during this task import them with relative paths into the old locations (`../../lib/theme-provider` etc.) or move those three files early; either is fine, just be consistent and fix in Task 4.

- [ ] Create `src/routes/index.tsx` as a port of `app/page.tsx` (home page; replace `next/link` per the replacement map).
- [ ] Copy `app/globals.css` to `src/index.css` and add `font-family: 'Inter', system-ui, sans-serif;` on `body` (replaces `next/font`). Tailwind content-glob updates happen in Task 5.
- [ ] Use `import.meta.env.DEV` to conditionally render `@tanstack/router-devtools` in `__root.tsx`.

**Verification**

- [ ] `npm run dev:client` starts; the TanStack Router plugin generates `src/routeTree.gen.ts` (this verification was deliberately moved here from Task 1 — it needs route files to exist)
- [ ] `npm run dev` (both processes) → `http://localhost:5173` renders nav, home page, and theme toggle; toggling persists across reload
- [ ] Browser console shows no `process is not defined` errors
- [ ] Commit: `feat(web): vite client shell with tanstack router`

---

## Task 4: Migrate Pages, Components, and Hooks with Behavior Parity

**Covers:** S3.1-S3.5, S6.1

**Files:**

- Create: `apps/web/src/routes/sessions.tsx`, `sessions.$id.tsx`, `sessions.$id.timeline.tsx`, `routes.tsx`, `routes.$id.tsx`, `gates.tsx`, `settings.tsx`
- Move: `apps/web/components/**` → `apps/web/src/components/**` (preserve the `session/` and `timeline/` subdirectories — client tests import `@/components/session/...` and keep working only if the relative shape is preserved)
- Move: `apps/web/lib/hooks/useSessionEvents.ts` → `apps/web/src/lib/hooks/useSessionEvents.ts`
- Move: `apps/web/lib/types/**` → `apps/web/src/lib/types/**`
- Move: `apps/web/lib/theme-provider.tsx`, `apps/web/lib/error-logger.ts` → `apps/web/src/lib/`
- Modify: `apps/web/tsconfig.json`, `apps/web/vitest.config.ts` (alias flip)
- Delete: `apps/web/lib/trpc.ts`, `apps/web/lib/trpc-provider.tsx` (superseded by the `src/lib/` ports from Task 3)

- [ ] **Flip the alias now**: in `tsconfig.json` change `@/*` from `./*` to `./src/*`; mirror the same change in `vitest.config.ts` (`'@': path.resolve(__dirname, './src')`). Client test imports (`@/lib/hooks/...`, `@/components/session/...`) keep resolving because the moved files preserve their relative shape under `src/`.
- [ ] Move all components into `src/components/` keeping subdirectory structure; delete the now-dead `'use client'` directives.
- [ ] Move `useSessionEvents`, `lib/types/*`, `theme-provider.tsx`, `error-logger.ts` into `src/lib/`. **Do not move** the filesystem readers (already in `server/lib/` since Task 2) or `auth-token.ts` (dead code, deleted in Task 5).
- [ ] Port each page per the **Next API → Vite/TanStack Replacement Map** above. For the three dynamic pages, params come from the route definition, e.g. in `sessions.$id.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sessions/$id')({
  component: SessionDetailPage,
});

function SessionDetailPage() {
  const { id } = Route.useParams();
  // body ported from app/sessions/[id]/page.tsx with next/link → Link
}
```

- [ ] Migrate the sessions list page with the current fields and empty/error states (`app/sessions/page.tsx` is fully `'use client'` + tRPC — the body ports unchanged apart from Link).
- [ ] Migrate the session detail page with budget, manifest, worktree, and timeline actions.
- [ ] Migrate the timeline page and preserve virtualized rendering (`VirtualTimeline` uses `@tanstack/react-virtual`, which is framework-agnostic — no changes).
- [ ] Migrate the routes page (search/grouping), route detail page, gates page (status filtering), and settings page with current behavior.
- [ ] Preserve `SessionControls` and its tRPC mutation flow.
- [ ] Preserve the `useSessionEvents` contract exactly: `{ status, connectionState, lastEvent, error, events }`, heartbeat rows excluded from `events`, bounded reconnect backoff (cap 10s). The hook body needs zero changes — only its file location moves; the SSE URL `/api/sessions/${sessionId}/events` now flows through the Vite proxy.
- [ ] Resolve the temporary relative imports left in `__root.tsx` from Task 3 back to `@/` aliases.

**Verification**

- [ ] `npm run test` — all Vitest suites pass (client tests via flipped `@/*`, server tests via `@server/*`)
- [ ] With `npm run dev`: sessions list loads through the standalone backend; detail page opens from the list; timeline renders events for an existing session; routes/gates/settings preserve current interactions; theme toggle survives navigation
- [ ] SSE: open a session detail page, kill `dev:server`, observe the reconnecting state, restart the server, observe recovery
- [ ] Commit: `feat(web): migrate pages and hooks to vite client`

---

## Task 5: Testing, Cleanup, and Final Cutover

**Covers:** S4.1, S6.2, S6.3

**Files:**

- Modify: `apps/web/playwright.config.ts`
- Modify: `apps/web/tailwind.config.js`
- Modify: `apps/web/package.json`
- Create: `apps/web/src/test/setup.ts` (only if client tests need shared setup; current per-file `@vitest-environment happy-dom` pragmas may suffice)
- Delete: `apps/web/app/` (this includes `app/api/` — no separate deletion needed)
- Delete: `apps/web/next.config.js`, `apps/web/next-env.d.ts` (if present)
- Delete: `apps/web/lib/auth-token.ts` (dead code — never imported; the Phase-D "SSE auth" was never wired up. If SSE auth is wanted, that is a new feature request against the spec, not part of this migration.)
- Delete: empty `apps/web/hooks/` and `apps/web/types/` directories
- Delete: `apps/web/lib/` (must be empty after Tasks 2-4 moves — verify before removing)

- [ ] Update `playwright.config.ts`: `baseURL: 'http://localhost:5173'`, `webServer.url: 'http://localhost:5173'`, keep `command: 'npm run dev'` (concurrently now starts both client and backend, satisfying "run Playwright with both processes").
- [ ] Update Tailwind content globs:

```js
content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
```

- [ ] PostCSS config is Vite-compatible as-is (tailwindcss + autoprefixer) — verify, don't rewrite.
- [ ] Remove Next-related dependencies from `package.json`: `next`, `eslint-config-next`. Also remove the verified-unused `zustand`, `react-window`, `@types/react-window`. Replace the dropped `next lint` with `"lint": "eslint ."` plus a minimal flat config, or omit linting from this migration and note it in BACKLOG.md — do not leave a broken `lint` script.
- [ ] Delete the Next runtime bridge: the whole `app/` tree (pages were ported in Task 4; `app/api/trpc/[trpc]/route.ts` and `app/api/sessions/[sessionId]/events/route.ts` are superseded by the Express host).
- [ ] Do not delete `apps/web/server/` — it is the backend host now.
- [ ] Confirm `tsconfig.json` no longer references `next-env.d.ts` or `.next/types` (done in Task 1; re-check after deletions).

**Verification**

- [ ] `npm run test` — unit suites pass
- [ ] `npm run test:e2e` — Playwright suites pass against the Vite app
- [ ] `npm run build` — typecheck + production build succeed
- [ ] `grep -r "from 'next" apps/web/src apps/web/server` returns nothing
- [ ] Smoke-check `/sessions`, `/routes`, `/gates`, `/settings` in the built preview (`npm run preview` + `npm run dev:server`)
- [ ] Compare cold-start time against the pre-migration `next dev` baseline recorded per S6.2
- [ ] Commit: `feat(web): cut over to vite, remove next runtime`

---

## Self-Review Checklist

- [ ] The spec and plan both preserve session control behavior
- [ ] No task asks for a second parallel backend implementation
- [ ] `apps/web/server/` is preserved as the backend host
- [ ] The `@/*` alias flip happens only in Task 4, together with the file moves and the vitest mirror change
- [ ] Server test imports were moved to `@server/*` in Task 2, before the flip could break them
- [ ] No client module depends on filesystem readers
- [ ] No browser-bundled code reads `process.env` (the two offending lines in `lib/trpc.ts` are removed in Task 3)
- [ ] Existing route, gate, and session readers are reused or moved, not copied
- [ ] Dead code (`auth-token.ts`) and unused deps (`zustand`, `react-window`) are removed explicitly, not "as encountered"
- [ ] Cleanup removes Next-specific runtime wiring only after parity is reached
- [ ] Verification includes unit, E2E, and build checks, plus the S6.2 startup-time baseline comparison

---

## Execution Notes

**Estimated time:** 3-5 days for a single developer

**Dependencies:**

- Node.js 18+
- npm 9+

**Primary risk areas:**

1. The `@/*` alias flip in Task 4 — mitigated by sequencing (server off `@/` in Task 2, flip + moves + vitest mirror in one commit) and by `npm run test` gating each task
2. `useSessionEvents` behavior during the move — mitigated by moving the file unchanged and keeping the client-test import shape stable
3. `session-reader` cwd coupling — mitigated by the `dev:server` script always running from `apps/web`; hardening the resolution is out of scope
4. Deleting Next files too early — mitigated by keeping the bridge alive through Task 4 and deleting only in Task 5 after parity verification

**Definition of done:**

- The Vite app is the primary frontend entrypoint
- The standalone backend serves tRPC and SSE
- Existing behavior is preserved for sessions, timeline, routes, gates, settings, and theme
- Tests and build pass under the new runtime
- No `next` imports or dependencies remain in `apps/web`

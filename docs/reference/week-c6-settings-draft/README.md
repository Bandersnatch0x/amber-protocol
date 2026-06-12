# ⚠️ Week C6 "Settings & Preferences" draft — SCOPE-DRIFT CASE STUDY

**Status: rejected work, kept as a cautionary example. Do NOT implement this.**
**This directory is not wired into the app and is safe to delete.**

## Verdict (checked against SPEC.md)

This draft was audited against the product boundary in `SPEC.md` and the
shipped web viewer, and it **conflicts with the project's positioning**.
It is preserved only as a concrete example of how an agent workflow drifted
from "repo-local read-only viewer" toward "multi-tenant SaaS backend" — the
exact class of drift the SPEC's review/accept gates exist to block.

| Dimension | SPEC / shipped master | This draft |
| --- | --- | --- |
| Product boundary | SPEC §3: "not a project management SaaS … or **generic app scaffold**"; repo-local single-developer governance tool | 10-table **multi-user account/auth backend**: `user_profiles` (email+verification), `user_sessions` (token+device tracking), `password_changes`, `rate_limits` |
| State model | SPEC §8: **Git-friendly JSON files** (`.amber/`, `feature_list.json`) | **Postgres + JSONB**, `audit_log`, GDPR IP hashing, soft delete, `config_history` |
| Web app architecture | Viewer reads session files via `fs`, **read-only, zero database** | Persistent DB layer, user sessions, email-verification tokens |
| User concept | Amber has **no "user" concept**; it is a local tool | Everything keyed on `user_id`, multi-tenant, GDPR compliance |

The only fragment that even relates to the viewer — appearance/density/theme
preferences — already ships on master (`next-themes` + the simple
`apps/web/app/settings/page.tsx`).

## Why it was never merged

1. **Out of scope** — see the table above. This is the primary reason.
2. **Half-finished server layer.** `server/routers/settings.ts` and
   `profile.ts` use an in-memory `new Map()` mock (`// Mock database -
   replace with actual DB calls`); `server/db/schema.sql` is an unused
   sketch — nothing wires the routers to a real database.
3. **Conflicts with shipped work.** The draft's `server/index.ts` and
   `app/layout.tsx` would remove master's merged `gate` / `sessionControl`
   routers and the Phase D `ErrorBoundary`. See the captured
   `wf-*-uncommitted.diff` files.

## What this directory is FOR

- **Review-gate training material**: when evaluating agent-produced work,
  compare the artifact against SPEC §3 (boundary) and §8 (state model)
  before admiring its internal code quality. This draft is well-written
  Zod/TypeScript/SQL — and still wrong for this product.
- **Recovery insurance**: `wf-20-uncommitted.diff` and
  `wf-22-uncommitted.diff` preserve the raw uncommitted working-tree
  changes from the removed worktrees, verbatim.

If a real settings feature is ever needed, design it repo-local and
file-backed (e.g. `localStorage` or a dotfile), not from this draft.

## Provenance

- Source worktree: `wf_217923b8-718-22`, HEAD `bac8794` (behind master);
  code existed only as uncommitted working-tree files.
- Worktrees `wf_217923b8-718-{19,20,21,22}` were removed after this export.

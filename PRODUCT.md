# Product

> Scope: this file is the design contract for the optional Amber Protocol Web Viewer.
> The product definition, target environment, users, and core value are governed by
> `docs/wiki/product/overview.md`; this file does not define Amber Protocol as a whole.

## Register

product

## Users

Repository Maintainers and reviewers using the optional Web Viewer with a Coding-Agent-Enabled Repository. They inspect session progress, review timelines, control supported session lifecycle actions, inspect routes, and make go/no-go decisions on approval gates.

## Product Purpose

Amber Protocol Web Viewer is an optional inspector for repository-local Amber state. It surfaces session status, timeline events, route definitions, and approval gates so maintainers can inspect and intervene when needed. Success: users trust the interface as a view of governed state without mistaking it for Amber's authority or primary product surface.

## Journey Contract

- **Target user and job:** a Repository Maintainer or reviewer must determine where a Coding-Agent-Enabled Repository is in J0–J5, why it is there, and which governed action or decision comes next.
- **Page task:** judgment. The home page is not a marketing dashboard or an execution wizard.
- **Maturity:** release surface backed by repository-local APIs; no invented sample state.
- **Primary path:** identify the current core Journey → read the next action and reason → inspect the relevant session or Gate → review supporting evidence.
- **Primary action:** open the session or Gate that owns the current decision. J0/J1 mutations remain in the Agent/CLI surface.
- **Required evidence:** lifecycle next action, active sessions, pending Gates, timestamps, route identity, and links to repository-local evidence surfaces.
- **States:** loading, empty, unavailable, active, pending, failed/paused, and completed must remain distinguishable. Unknown backend steps degrade to their original text instead of being silently remapped.
- **Information hierarchy:** current Journey and next action first; operational work and review pressure second; conditional paths and technical reference last.
- **Responsive behavior:** the same reading order is preserved on mobile; Journey steps stack without horizontal overflow.
- **Visual intent:** reuse the existing Obsidian/Porcelain tokens, compact type, semantic status colors, flat tonal depth, and a single blue interaction accent. No new decorative system is introduced.
- **Authority boundary:** the Viewer reflects Amber state. It does not define a second workflow, infer approval, or turn Suggestions into a default core journey.

Observable acceptance checks:

1. The home page names Trusted Continuation and shows J0–J5 in order.
2. Exactly one Journey is marked current from live lifecycle/session/Gate state.
3. A known lifecycle next step determines the current Journey. Without one, a pending Gate resolves to J5 and active work resolves to J3.
4. Sessions and Gates remain the primary operational entries; Suggestions is conditional.
5. Desktop, mobile, dark mode, reduced motion, loading, empty, and query-failure checks continue to pass.

## Brand Personality

Technical, precise, calm. The tool should feel like a well-built developer utility (Linear, Vercel dashboard, Railway): trustworthy, information-dense, never flashy. Three words: quiet, competent, responsive.

## Anti-references

- Consumer dashboards with hero metrics and gradient cards (Datadog marketing, generic SaaS landing)
- Over-decorated admin panels with excessive shadows, rounded corners, and animation
- Terminal-only interfaces that sacrifice readability for density
- Any UI that draws attention to itself rather than the data

## Design Principles

1. **Data first**: every pixel serves information delivery. Decorative elements are earned, not default.
2. **Consistent vocabulary**: same component styles across all pages. Buttons, badges, cards, inputs follow one system.
3. **Responsive state**: loading, error, empty, and live states are first-class, not afterthoughts.
4. **Quiet confidence**: the interface communicates through clarity, not volume. No unnecessary animation, no gradient text, no hero metrics.
5. **Developer-native**: respects the user's time and expertise. Dense where density helps, spacious where focus matters.

## Accessibility & Inclusion

- WCAG 2.1 AA compliance target
- Dark mode support (already implemented via next-themes)
- Reduced motion support needed for any future animations
- Color contrast must meet 4.5:1 for body text, 3:1 for large text
- Keyboard navigation for all interactive elements

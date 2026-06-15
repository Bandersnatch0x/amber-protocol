# Product

## Register

product

## Users

Developers using Amber Protocol for autonomous coding sessions. They monitor session progress, review timelines, control session lifecycle (start/pause/abort), inspect routes, and manage approval gates. Context: at their desk, checking on long-running AI agent tasks, making go/no-go decisions on gates.

## Product Purpose

Amber Protocol Web Viewer provides real-time visibility into autonomous coding sessions. It surfaces session status, timeline events, route definitions, and approval gates so developers can monitor, control, and intervene when needed. Success: developers trust the interface to show what their agents are doing without switching to the CLI.

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

---
name: Amber Protocol Web Viewer
description: Real-time session monitoring for autonomous coding agents. Quiet, precise, data-first developer tooling.
colors:
  debug-blue: "#2563eb"
  debug-blue-hover: "#1d4ed8"
  debug-blue-muted: "#dbeafe"
  steel-white: "#ffffff"
  steel-fog: "#f8fafc"
  steel-wash: "#f1f5f9"
  graphite: "#0f172a"
  graphite-mid: "#475569"
  graphite-light: "#64748b"
  steel-line: "#e2e8f0"
  steel-line-hover: "#cbd5e1"
  emerald: "#16a34a"
  emerald-muted: "#dcfce7"
  amber: "#d97706"
  amber-muted: "#fef3c7"
  crimson: "#dc2626"
  crimson-muted: "#fee2e2"
typography:
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.55
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: "0.05em"
    textTransform: "uppercase"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.66
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
---

# Design System: Amber Protocol Web Viewer

## 1. Visual Theme and Atmosphere

Amber Protocol Web Viewer is a repository-local command surface for developers supervising autonomous coding sessions. It should feel like a calm control room inside an IDE: dense enough for repeated use, legible at a glance, and strict about showing evidence before action.

The interface serves the product. It is not a landing page and it is not a marketing dashboard. The design must privilege session status, event timelines, route definitions, approval gates, and transcript evidence. The product personality is quiet, competent, responsive, and developer-native.

Use restrained product UI patterns. Familiarity is a feature here: top navigation, filter bars, compact cards, status badges, progress bars, data lists, expandable raw JSON, and clear empty/error/loading states. No decorative hero treatment. No oversized metrics. No visual effects that compete with the data.

## 2. Color Palette and Roles

### Primary Foundation

- Steel Fog (#f8fafc): page background in light mode.
- Steel White (#ffffff): primary content surface for cards, panels, inputs, and top navigation.
- Steel Wash (#f1f5f9): inset areas, code blocks, skeleton bars, and quiet secondary panels.
- Graphite (#0f172a): primary text, headings, active labels, and important values.
- Graphite Mid (#475569): secondary text, descriptions, captions, timestamps, and helper copy.
- Graphite Light (#64748b): tertiary labels, placeholders, disabled text, and low-priority metadata.
- Steel Line (#e2e8f0): default borders, dividers, timeline connector lines, and table rules.
- Steel Line Hover (#cbd5e1): hover border lift for interactive cards and form controls.

### Accent and Interactive

- Debug Blue (#2563eb): the single product accent. Use only for primary actions, selected navigation, links, focus rings, live route emphasis, and active filters.
- Debug Blue Hover (#1d4ed8): hover and pressed state for primary actions.
- Debug Blue Muted (#dbeafe): quiet status or selected backgrounds when the state is informational.

### Functional States

- Emerald (#16a34a) and Emerald Muted (#dcfce7): completed, approved, live, success.
- Amber (#d97706) and Amber Muted (#fef3c7): paused, pending, connecting, warning.
- Crimson (#dc2626) and Crimson Muted (#fee2e2): failed, rejected, aborted, destructive.

State colors are never decorative. If a color appears, it must communicate state, selection, or action priority.

## 3. Typography Rules

Use one practical sans family for the product UI. Inter is allowed because it is already committed in the project and fits the product register. Use JetBrains Mono only for session ids, route ids, commands, raw events, transcript tool names, and code-like evidence.

- Page titles: 24px, 700, compact line-height. One per screen.
- Section titles: 18px, 600, used on cards and major panels.
- Body: 14px, 400, 1.5 line-height.
- Labels: 12px, 500, uppercase, 0.05em tracking. Use for metadata keys and field labels only.
- Mono: 12px, 400, 1.66 line-height. Use for technical identifiers and raw data.

Avoid display typography, fluid heading scales, serif pairings, gradient text, and giant numerals. Product density is controlled by spacing and grouping, not by dramatic type.

## 4. Component Stylings

### App Shell

Sticky top navigation, 56px high, white surface in light mode and graphite surface in dark mode. Left side contains a compact Amber mark and product name, followed by horizontal navigation items: Sessions, Transcripts, Routes, Gates, Settings. Right side contains Docs and a theme toggle. On mobile, keep a separate horizontal scroll nav below the top bar.

### Buttons

Primary buttons use Debug Blue and white text. Secondary buttons are white or dark surface with steel borders. Danger buttons use Crimson. All buttons use 6px radius, 14px text, clear focus rings, disabled states, loading labels, and a minimum 44px tap target where practical.

### Cards and Panels

Cards use 8px radius, 1px steel border, no shadow at rest, and 16-24px internal padding. Interactive cards may lift only through border color and a tiny hover shadow. Do not create nested cards. Prefer dividers and inset panels for dense detail.

### Badges and Chips

Badges use compact rounded rectangles, 12px medium text, and semantic muted backgrounds. Session statuses include Idle, Running, Executing, Paused, Completed, Aborted, Created, Routed, and Failed. Gate statuses include Pending, Approved, and Rejected.

### Inputs and Filters

Search inputs and selects use labeled or aria-labeled controls, steel borders, 6px radius, 14px text, and a visible Debug Blue focus ring. Filter bars should stay compact and line up with list content.

### Tables, Lists, and Timelines

Lists use stacked interactive rows when item content is mixed. Routes can use grouped grids because route cards are compact and comparable. Timelines use a vertical event rail with line icons, event number, event type badge, timestamp, relative offsets, detail key-value pairs, and optional raw JSON expansion.

### Dialogs

Use dialogs only for destructive confirmation, such as aborting a session. The dialog must include a strong title, one paragraph explaining consequence, Cancel, and Abort. Scrim should isolate foreground content without feeling theatrical.

## 5. Layout Principles

Use a max-width content container around 1280px with responsive side padding. Desktop-first structure is acceptable because developers use this at a desk, but every screen must collapse cleanly to mobile.

Common layouts:

- Overview/home: asymmetric two-column opening, then surface cards and evidence panels.
- Lists: header, compact filter bar, loading/error/empty state, then stacked rows or grouped grids.
- Detail pages: header with back link and status, primary content column plus metadata side panel.
- Timeline: header, optional metrics summary, filter bar, vertical event rail.
- Settings: narrow single-column form stack with persistent save feedback.

Do not use a landing-page hero, three equal feature-card marketing grid, giant KPI row, decorative gradients, side-stripe cards, glassmorphism, or over-rounded surfaces.

## 6. Motion and Interaction

Motion is state feedback only. Use 150-250ms color, opacity, and transform transitions. Loading states are skeletons that match final layout dimensions. Do not use orchestrated page-load animations or decorative looping motion. Reduced motion must disable nonessential transitions.

All interactive elements must have default, hover, focus, active, disabled, loading, and error treatment when applicable. Keyboard navigation and focus visibility are part of the design, not optional polish.

## 7. Stitch Generation Rules

When generating screens in Stitch, attach this design system at the project level. Screen prompts should describe structure, content, state, and interactions only. Do not repeat colors, font names, radius values, or theme tokens inside individual screen prompts.

Every generated screen should include realistic developer-tool content: session ids, route ids, status labels, timestamps, token budgets, stage names, gate descriptions, and transcript turn excerpts. Avoid generic placeholders like Acme, John Doe, 99.99%, and vague copy such as "Elevate", "Seamless", "Unleash", or "Next-Gen".

## 8. Anti-Patterns

- No marketing hero sections.
- No hero metrics template.
- No gradient text.
- No decorative blur or glass panels.
- No decorative grid backgrounds.
- No side-stripe borders.
- No nested cards.
- No oversized card radius.
- No emoji as structural icons.
- No custom scrollbars.
- No fake round-number claims.
- No generic SaaS illustration.
- No centered empty praise copy. Empty states should teach the workflow.
- No modal as a first choice except destructive confirmation.

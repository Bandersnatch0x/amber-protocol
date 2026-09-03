---
name: Amber Protocol Web Viewer
description: Real-time session monitoring for autonomous coding agents — data-first, developer-native.
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
  graphite-inverse: "#ffffff"
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
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
    letterSpacing: "0.05em"
    textTransform: "uppercase"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.666
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.555
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
components:
  button-primary:
    backgroundColor: "{colors.debug-blue}"
    textColor: "{colors.steel-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.debug-blue-hover}"
  button-secondary:
    backgroundColor: "{colors.steel-white}"
    textColor: "#334155"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-danger:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.steel-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  badge-status:
    rounded: "{rounded.md}"
    padding: "2px 8px"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.steel-white}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  input:
    backgroundColor: "{colors.steel-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
---

# Design System: Amber Protocol Web Viewer

## 1. Overview

**Creative North Star: "The Command Surface"**

A developer's monitoring tool should behave like the cockpit of a well-built aircraft: every element exists to deliver information, every interaction is immediate, and the interface itself disappears into the task. Amber Protocol's Web Viewer is built on this principle. It presents session status, timeline events, route definitions, and approval gates with the precision of an IDE panel — dense where density helps, spacious where focus matters.

This system explicitly rejects the patterns PRODUCT.md calls out: consumer dashboards with hero metrics and gradient cards, over-decorated admin panels with excessive shadows and rounded corners, and any UI that draws attention to itself rather than the data. The viewer is a tool, not a showcase.

The palette is cool-slate neutrals against a clean white surface, punctuated by a single debug-blue accent reserved for primary actions and current selection. Dark mode inverts to deep graphite with the same blue, maintaining identical information hierarchy. Motion is restricted to state feedback — fade-in on load, slide-up on expand — and never choreographed.

**Key Characteristics:**

- Data-first: every pixel serves information delivery; decorative elements are earned, not default
- Consistent vocabulary: same component styles across all pages — buttons, badges, cards, inputs follow one system
- Responsive state: loading, error, empty, and live states are first-class, not afterthoughts
- Developer-native: respects the user's time with familiar affordances and predictable layout
- Quiet confidence: communicates through clarity, not volume

## 2. Colors: The Steel + Debug Palette

A cool-neutral foundation of slate grays (steel surfaces, graphite ink) provides the structural layer. A single debug-blue accent carries semantic weight: it marks primary actions, active selections, and live connection states. Semantic colors (emerald for success, amber for warnings, crimson for errors) are reserved exclusively for status communication.

### Primary

- **Debug Blue** (#2563eb): The sole accent. Used for primary action buttons, active tab indicators, link text, focus rings, and live connection badges. Its rarity is the point — it draws the eye only to what matters right now.

### Neutral

- **Steel White** (#ffffff): Primary content surface. Cards, inputs, and panels sit on this base in light mode.
- **Steel Fog** (#f8fafc): Page background. One step darker than the content surface, creating subtle depth through tonal layering.
- **Steel Wash** (#f1f5f9): Tertiary surface for code blocks, pre-formatted content, and inset panels.
- **Graphite** (#0f172a): Primary text. High-contrast against steel-white (15.4:1). Used for headings, body text, and active labels.
- **Graphite Mid** (#475569): Secondary text for descriptions, timestamps, and supporting information.
- **Graphite Light** (#64748b): Tertiary text for captions, disabled labels, and placeholder content.
- **Steel Line** (#e2e8f0): Default border color for cards, inputs, dividers, and the timeline connector.
- **Steel Line Hover** (#cbd5e1): Elevated border on hover states.

### Semantic

- **Emerald** (#16a34a): Success and completion states. Completed badges, passed gates, live connection dots.
- **Amber** (#d97706): Warning and transitional states. Paused session badges, connecting indicators.
- **Crimson** (#dc2626): Error, abort, and failure states. Failed badges, error messages, destructive action buttons.

Each semantic color has a muted variant (10% opacity tint) used as badge and chip backgrounds: emerald-muted (#dcfce7), amber-muted (#fef3c7), crimson-muted (#fee2e2).

### Named Rules

**The Single Accent Rule.** Debug Blue is used on ≤10% of any given screen. It marks the single most important action or selection. If two elements compete for blue, the hierarchy is wrong.

**The Semantic Purity Rule.** Emerald, amber, and crimson are never decorative. They communicate state: success, warning, error. Using them as brand colors or section accents violates the system.

**The Tonal Layering Rule.** Depth is conveyed through surface tones (white → fog → wash), not shadows. The surface stack creates hierarchy without lifting elements off the page.

## 3. Typography

**Display Font:** Inter (with system-ui, -apple-system fallback)
**Body Font:** Inter (same stack)
**Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular fallback)

**Character:** One family carries the entire interface. Inter's neutral, highly legible letterforms at small sizes make it ideal for data-dense UI. No display font is needed — the system's personality comes from precision and density, not typographic drama. JetBrains Mono handles code excerpts, raw event JSON, and technical labels.

### Hierarchy

- **Title** (600, 1.125rem / 18px, line-height 1.555): Page titles and section headings. One per screen or card.
- **Body** (400, 0.875rem / 14px, line-height 1.5): Default text size for descriptions, content, and button labels. Max line length 65–75ch in prose contexts.
- **Label** (500, 0.75rem / 12px, line-height 1.333, letter-spacing 0.05em, uppercase): Metadata labels, timestamp captions, badge text, and field labels. The tracking and case create a clear visual separation from content.
- **Mono** (400, 0.75rem / 12px, line-height 1.666): Code blocks, raw JSON, technical identifiers, and event data. JetBrains Mono's distinguishing letterforms prevent confusion between similar characters.
- **2xs** (400, 0.625rem / 10px, line-height 1.4): Footnotes, connection status text, and ultra-compact metadata. Used sparingly.

### Named Rules

**The One Family Rule.** Inter carries headings, body, labels, and buttons. No display font, no serif pairing. The system's authority comes from consistency, not contrast.

**The Mono Boundary Rule.** JetBrains Mono appears only in code blocks, raw data displays, and technical identifiers. It never appears in navigation, headings, or user-facing prose.

## 4. Elevation

This system is flat by default. Depth is conveyed through the tonal surface stack (white → fog → wash) and border color shifts, not through shadows. The design follows what PRODUCT.md calls "data first" — shadows would compete with the information hierarchy.

The sole exception is the hover state on interactive cards: a subtle `shadow-sm` (0 1px 2px rgba(0,0,0,0.05)) combined with a border-color lift to steel-line-hover signals interactivity without creating visual noise.

### Shadow Vocabulary

- **Hover Lift** (`box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05)`): Applied to cards and interactive containers on hover only. Combined with a border-color shift from steel-line to steel-line-hover. Never at rest.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to hover state. If it looks like the card is floating, the shadow is too dark.

**The Tonal Depth Rule.** Background hierarchy is: page (steel-fog) → card (steel-white) → inset (steel-wash). Never use shadow to create this hierarchy; use the surface tones.

## 5. Components

### Buttons

- **Shape:** Gently rounded (6px radius). Compact padding (8px 16px) at 14px text. Inline-flex with center alignment.
- **Primary:** Debug Blue background (#2563eb) with white text. The blue marks the single most important action on any screen.
- **Hover / Focus:** Background darkens to debug-blue-hover (#1d4ed8). Focus ring: 2px offset ring in blue-500. Transition: 150ms color shift.
- **Secondary:** Steel White background with slate-700 text and steel-line border. Used for subordinate actions (pause, resume).
- **Danger:** Crimson background (#dc2626) with white text. Reserved for destructive actions (abort). Focus ring in red-500.
- **Disabled:** All variants reduce to 50% opacity. Cursor changes to not-allowed.

### Status Badges

- **Shape:** Compact pill (4px vertical, 8px horizontal padding). 12px medium-weight text.
- **Running / Executing:** Blue-muted background with blue-700 text.
- **Completed:** Emerald-muted background with emerald-700 text.
- **Paused:** Amber-muted background with amber-800 text.
- **Aborted / Failed:** Crimson-muted background with crimson-700 text.
- **Idle / Created / Routed:** Slate-100 background with slate-700 text. Neutral state, no semantic color.

### Chips / Tags

- **Style:** Rounded-md background pill (same shape as badges). Slate-100 background with slate-600 text. Used for metadata like timestamps and offsets.
- **Event Type Tags:** Blue-muted background with blue-700 text. Applied to timeline event type labels.

### Cards / Containers

- **Corner Style:** Gently curved (8px radius).
- **Background:** Steel White (#ffffff) in light mode; dark slate (#1e293b) in dark mode.
- **Shadow Strategy:** Flat at rest. Hover state adds shadow-sm plus border-color lift to steel-line-hover.
- **Border:** 1px solid steel-line (#e2e8f0) at rest.
- **Internal Padding:** 16px standard.

### Inputs / Fields

- **Style:** Steel White background with steel-line border. 6px radius. 8px 16px padding. 14px body text.
- **Focus:** 2px focus ring in blue-500. Border remains steel-line; the ring signals focus, not a border color change.
- **Placeholder:** Graphite Light color (#64748b) at 4.5:1 contrast minimum.
- **Select / Dropdown:** Same styling as text inputs. Native browser controls with consistent border and focus treatment.

### Navigation

- **Theme Toggle:** Icon button (sun/moon) with steel-line border. Hover shifts to steel-fog background. Compact (p-2).
- **Connection Indicator:** Dot (1.5 × 1.5, rounded-full) + 12px label. Emerald dot = live, amber-dot-pulse = connecting, slate dot = disconnected, crimson dot = error.

### Timeline Events

- **Shape:** Vertical timeline with 40px circular event icons (emoji in slate-100 circle) connected by a 1px steel-line vertical rule.
- **Content:** Each event is a card-hover with expand/collapse capability. Header shows event index, type tag, and timestamp. Metadata displayed in a 2-column responsive grid of label-value pairs.
- **Expanded State:** Raw JSON in a steel-wash pre block with mono typography.

## 6. Do's and Don'ts

### Do:

- **Do** use Debug Blue (#2563eb) exclusively for primary actions, active selections, and focus rings. Its rarity is the system's visual grammar.
- **Do** maintain the tonal surface stack: page (steel-fog) → card (steel-white) → inset (steel-wash). This is how depth works.
- **Do** use semantic colors only for state communication: emerald for success, amber for warning, crimson for error.
- **Do** keep all interactive elements at 6px radius (md). Inconsistency breaks the system's quiet authority.
- **Do** use the label style (uppercase, 12px, 500 weight, 0.05em tracking) for all metadata and field labels.
- **Do** verify body text contrast ≥4.5:1 against its background. Graphite (#0f172a) on steel-white (#ffffff) is 15.4:1 — well above threshold. Check dark-mode pairings individually.
- **Do** use 150ms transitions for all state changes. Users are in flow; don't make them wait for choreography.
- **Do** treat loading, error, empty, and live states as first-class. A card with no state handling is incomplete.

### Don't:

- **Don't** use hero metrics with big numbers, small labels, and gradient accents. PRODUCT.md calls this out as a consumer dashboard cliché.
- **Don't** add decorative shadows, glassmorphism, or blur effects. The system is flat by default; elevation is tonal.
- **Don't** use gradient text (`background-clip: text` with gradients). Emphasis comes from weight and size.
- **Don't** apply side-stripe borders (colored `border-left` > 1px). Use full borders, background tints, or leading icons instead.
- **Don't** use display fonts, serif pairings, or decorative typography. Inter carries everything; JetBrains Mono handles code.
- **Don't** animate layout properties (width, height, padding). Transform and opacity only.
- **Don't** create identical card grids with icon + heading + text repeated endlessly. Vary content structure.
- **Don't** use tiny uppercase tracked eyebrows ("ABOUT", "PROCESS") above every section. One named label system is voice; eyebrows on every section is AI grammar.
- **Don't** over-decorate admin panels with excessive shadows, rounded corners, or animation — PRODUCT.md lists this as an anti-reference.
- **Don't** sacrifice readability for density. If text feels cramped, add space; density serves scanning, not compression.

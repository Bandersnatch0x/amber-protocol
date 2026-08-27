---
name: Amber Protocol Web Viewer — Obsidian & Amber Pulse
description: High-precision developer command surface for autonomous AI coding agents. Linear & Raycast grade craftsmanship, quiet authority, and tactile developer ergonomics.
colors:
  # Obsidian Dark Palette (Default Pro Experience)
  obsidian-void: "#080B10"
  obsidian-surface: "#0F141C"
  obsidian-elevated: "#151D28"
  obsidian-inset: "#1B2433"
  obsidian-border: "rgba(255, 255, 255, 0.08)"
  obsidian-border-hover: "rgba(255, 255, 255, 0.16)"
  obsidian-border-active: "rgba(245, 158, 11, 0.35)"

  # Porcelain Light Palette
  porcelain-void: "#F8FAFC"
  porcelain-surface: "#FFFFFF"
  porcelain-elevated: "#FFFFFF"
  porcelain-inset: "#F1F5F9"
  porcelain-border: "#E2E8F0"
  porcelain-border-hover: "#CBD5E1"

  # Core Signature Dual Accents
  amber-gold: "#F59E0B"
  amber-gold-hover: "#D97706"
  amber-gold-muted: "rgba(245, 158, 11, 0.12)"
  amber-gold-glow: "0 0 24px -2px rgba(245, 158, 11, 0.25)"

  cobalt-blue: "#2563EB"
  cobalt-blue-hover: "#1D4ED8"
  cobalt-blue-muted: "rgba(37, 99, 235, 0.12)"
  cobalt-blue-glow: "0 0 24px -2px rgba(37, 99, 235, 0.3)"

  # Semantic Status Aura
  emerald-pass: "#10B981"
  emerald-pass-muted: "rgba(16, 185, 129, 0.12)"
  crimson-fail: "#F43F5E"
  crimson-fail-muted: "rgba(244, 63, 94, 0.12)"
  slate-idle: "#64748B"
  slate-idle-muted: "rgba(100, 116, 139, 0.12)"

typography:
  display:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
    textTransform: "uppercase"
  mono:
    fontFamily: "JetBrains Mono, Geist Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.6
    fontVariantNumeric: "tabular-nums"
    letterSpacing: "-0.01em"

rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "9999px"

spacing:
  2xs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"

shadows:
  glow-amber: "0 0 20px -4px rgba(245, 158, 11, 0.18)"
  glow-cobalt: "0 0 20px -4px rgba(37, 99, 235, 0.22)"
  tactile-card: "0 4px 20px -2px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.15)"
  floating-palette: "0 16px 48px -8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)"
---

# Design System: Amber Protocol Web Viewer (Obsidian & Amber Pulse)

## 1. Creative North Star: "The Autonomous Flight Deck"

Amber Protocol Web Viewer is a **mission-control cockpit** for developers supervising autonomous AI agent sessions. It fuses the restrained, razor-sharp craftsmanship of **Linear** and **Raycast** with the unyielding security rigor of **Amber Protocol**.

### The Core Design Tenets:
1. **Obsidian Depth & Luminous Hierarchy**: Deep obsidian surfaces (`#080B10` → `#0F141C` → `#151D28`) eliminate glare and frame information with micro-contrast. 1px hairline borders (`rgba(255,255,255,0.08)`) create razor-sharp separation without visual bulk.
2. **Signature Dual Accent**:
   - **Amber Gold (`#F59E0B`)**: The protocol's signature — represents governance authority, unforgeable ledger seals, pending human gates, and live pulse heartbeats.
   - **Cobalt Blue (`#2563EB`)**: Developer interaction — represents keyboard focus, active selections, and executable command buttons.
3. **Information Density with Breathability**: Monospace numbers use `tabular-nums` for rock-solid tabular alignment. Micro-labels are tight and tracked (`0.06em uppercase`). Content breathes through a disciplined 4px/8px rhythm.
4. **Tactile Haptic Feedback**: Smooth spring cubic-bezier transitions (`cubic-bezier(0.16, 1, 0.3, 1)`), hover border illumination, and live status aura pulses create immediate responsiveness.
5. **No SaaS Clutter**: Zero generic hero metrics, zero decorative gradient text, zero floating 3D spheres. Every pixel exists to deliver actionable runtime truth.

---

## 2. Color Token Architecture

### 2.1 Dark Obsidian Tonal Stack (Primary Pro Target)
- **Void Canvas** (`#080B10`): Infinite canvas background with subtle 20px radial dot matrix.
- **Surface Level 1** (`#0F141C`): Main card containers, master lists, inspector panels.
- **Elevated Level 2** (`#151D28`): Modal command palette, dropdown flyouts, floating status pills.
- **Inset Wash Level 3** (`#1B2433`): Terminal outputs, AST JSON nodes, diff blocks, and code editors.
- **Hairline Borders**: `rgba(255, 255, 255, 0.08)` resting, `rgba(255, 255, 255, 0.18)` on hover/focus.

### 2.2 Light Porcelain Tonal Stack
- **Void Canvas** (`#F8FAFC`): Crisp neutral slate canvas.
- **Surface Level 1** (`#FFFFFF`): Elevated white cards with hairline border `#E2E8F0`.
- **Inset Wash Level 3** (`#F1F5F9`): Tertiary code blocks and metadata tags.

### 2.3 Semantic Status Auras (Functional Only)
- **Pass / Completed / Healthy**: Emerald `#10B981` (Glow: `rgba(16, 185, 129, 0.15)`)
- **Pending / Gate Waiting / Paused**: Amber Gold `#F59E0B` (Glow: `rgba(245, 158, 11, 0.2)`)
- **Blocked / Failed / Aborted**: Crimson Rose `#F43F5E` (Glow: `rgba(244, 63, 94, 0.2)`)
- **Idle / Staged / Neutral**: Slate `#64748B`

---

## 3. Typography Hierarchy

- **Title / Headline**: Geist / Inter (600 semi-bold, letter-spacing `-0.02em`)
- **Body UI**: Inter (400 regular & 500 medium, line-height `1.5`)
- **Engineering Mono**: JetBrains Mono (400 & 600, tabular numerals, letter-spacing `-0.01em`)
- **Micro Metadata**: Geist Label (600, `0.6875rem / 11px`, `tracking-wider`, uppercase)

---

## 4. Key Component Blueprints

### 4.1 Repository Pulse Header (`AppShell`)
- 52px ultra-compact sticky glass navigation bar (`backdrop-blur-md`).
- Left: Amber polygon badge with micro-glow + repository moniker + current branch in mono.
- Center: Global Route Tabs with glowing indicator underline.
- Right: **Repository Pulse Capsule** `[ ● 2 Active | 1 Gate Pending | 96% Health ]` with live heartbeat aura + `Cmd+K` trigger + theme/lang switches.

### 4.2 Split-View Gates Inbox (`/gates`)
- **Left Column (Master Rail - 380px)**: High-density triage stack. Filter by status (Pending/Approved/Rejected). Each row highlights trigger time, stage chip, and waiting duration.
- **Right Column (Detail Inspector - Flex)**:
  - Header: Gate metadata & full session ID with 1-click copy.
  - Reason & Context: Full prompt & trigger reason.
  - Live Audit Evidence: Ledger hash verification badge + inline Diff snapshot.
  - Action Footer: Reviewer identity field, `⌘+↵` Approve & Resume button, `⌘+⇧+↵` Reject with Reason.

### 4.3 Timeline Precision Scrubber (`/sessions/$id/timeline`)
- Vertical timeline rail with categorized tool icons (Terminal, Disk, Network, Gate).
- **Sub-second micro-duration deltas** (`+140ms`, `+1.8s`) between consecutive events.
- **Chronology-gap awareness**: Pauses >60s render as a dashed separator with human duration (e.g. `— 12m 45s wait —`).
- Interactive raw payload inspector with search & copy path.

### 4.4 Interactive AST / JSON Explorer
- Replace plain `<pre>` blocks with an interactive tree viewer featuring expandable nodes, syntax color highlights, and copy-value/copy-path shortcuts.

---

## 5. Keyboard Navigation & Accessibility (WCAG 2.1 AA)

- `Cmd+K` / `Ctrl+K`: Global Command Palette
- `J` / `K`: Up/Down navigation through lists & timeline events
- `A`: Quick-approve focused gate (with confirmation modal if destructive)
- `R`: Open reject drawer
- `Escape`: Clear active focus / close floating drawers
- Contrast ratios: Text ≥ 7.5:1 (Dark mode text `#F8FAFC` on `#080B10` is > 18:1).

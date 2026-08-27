# Amber Protocol Web Viewer — Design System (Obsidian & Amber Pulse v10)

## Brand Personality & Aesthetic Direction

Amber Protocol is a quiet, competent, highly disciplined governance surface for agent-assisted software engineering. The Web Viewer embodies a **Linear / Raycast 旗舰工装风 (Obsidian & Amber Pulse)** aesthetic — deep dark obsidian surfaces, hairline micro-luminous borders, signature amber gold protocol glows, and tactile engineering ergonomics.

- **Tone**: Focused cockpit, unforgeable audit trail, sub-second responsiveness, tactile density.
- **Anti-References**: No SaaS marketing bloat, no oversized vanity metric cards, no heavy drop shadows, no generic all-grey flat styling.

---

## 1. Dual Theme Color System

### A. Dark Mode: Obsidian Stack (Default Flight Deck)
- **Void (Canvas Base)**: `#080B10` — Pure dark obsidian base with 24px radial micro-dot matrix.
- **Surface Level 1 (Cards & Sidebars)**: `#0F141C` — High-density workspace panels.
- **Surface Level 2 (Elevated Panels & Modals)**: `#151D28` — Raised inspection drawers and dialogs.
- **Surface Inset (Code Blocks & AST Tree)**: `#1B2433` — Terminal excerpts, AST json blocks, and diffs.
- **Hairline Border (Resting)**: `rgba(255, 255, 255, 0.08)` — Precision 1px divider.
- **Hairline Border (Hover/Focus)**: `rgba(255, 255, 255, 0.18)` — Tactile highlight.

### B. Light Mode: Porcelain Stack (Crisp Command Deck)
- **Void (Canvas Base)**: `#F8FAFC` — Crisp porcelain with 24px subtle dot matrix.
- **Surface Level 1**: `#FFFFFF` — Pure white cards.
- **Surface Level 2**: `#FFFFFF` — Raised panels with subtle elevation.
- **Surface Inset**: `#F1F5F9` — Code excerpts and token blocks.
- **Hairline Border**: `#E2E8F0` — Clean structural hairline.
- **Hairline Border (Hover)**: `#CBD5E1`.

### C. Signature Dual Accents & Semantic Status
- **Amber Gold (Protocol Glow & Seals)**:
  - Base: `#F59E0B`
  - Hover: `#D97706`
  - Muted Aura: `rgba(245, 158, 11, 0.12)`
  - Glow: `0 0 24px -2px rgba(245, 158, 11, 0.25)`
  - Usage: Protocol signature marks, pending gate indicators, ledger immutable seals, active stage nodes.
- **Cobalt Blue (Interactive Primary)**:
  - Base: `#2563EB`
  - Hover: `#1D4ED8`
  - Muted: `rgba(37, 99, 235, 0.12)`
  - Glow: `0 0 24px -2px rgba(37, 99, 235, 0.30)`
  - Usage: Primary command buttons, keyboard focus rings, timeline scrubber cursor.
- **Emerald Pass**: `#10B981` (`rgba(16, 185, 129, 0.12)` background) — 100% tests passed, ledger chain intact.
- **Crimson Block**: `#F43F5E` (`rgba(244, 63, 94, 0.12)` background) — Gate rejected, security boundary violation, destructive action.

---

## 2. Typography Hierarchy

- **Display & Headline**: `Geist`, `Inter`, `sans-serif` (weight: 600/700, tight tracking `-0.02em`).
- **Body & Controls**: `Inter`, `-apple-system`, `sans-serif` (weight: 400/500, line-height 1.5).
- **Technical & Monospace**: `JetBrains Mono`, `monospace` (weight: 400/500/600, tabular numbers `font-variant-numeric: tabular-nums`).

---

## 3. Spatial System & Shape Language

- **Corner Radius**:
  - `rounded-md`: `6px` (Buttons, badges, form inputs, status chips)
  - `rounded-lg`: `8px` (Cards, inspector panels)
  - `rounded-xl`: `12px` (Modal dialogues, Command palette)
- **Spring Physics**:
  - `cubic-bezier(0.16, 1, 0.3, 1)` for 180ms tactile micro-interactions on button press (`scale(0.985)`).

---

## 4. Master Layout Paradigms

1. **Spacious AppShell Header (48px)**:
   - Left: Minimalist logo `[A] amber-protocol ▾ main`.
   - Center: Spacious text tabs with active bottom amber indicator.
   - Right: Sleek `⌘K` Quick Search + `● Live` status dot + Theme switcher (`☀️/🌙`).
2. **Master-Detail Split-View Cockpit (`/gates`)**:
   - Left rail (380px): High-density triage list.
   - Right rail (flex): Evidence, immutable ledger seal, inline diff, and reviewer decision footer.
3. **Timeline Micro-Deltas (`/sessions/$id/timeline`)**:
   - Sub-second intervals (`+180ms`) with chronology-gap awareness (`>60s breaks`).

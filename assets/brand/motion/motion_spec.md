# Amber Protocol Logo — Protocol Seal

## Brief

| Field | Value |
| --- | --- |
| Source | `assets/brand/amber-protocol-logo.png` |
| Concept | **Protocol Seal** — governed frame stays still; amber core breathes |
| Personality | Deliberate, crystalline, assured |
| Usage | README header, 160px display width |
| Duration | 2400ms seamless loop |
| Deliverable | `assets/brand/amber-protocol-logo.gif` (320×320, < 2MB) |

## Part inventory

Raster delivery uses layered duplicates in `logo_motion.html`. Vector targets for a future pixel2motion pass:

| Id | Element | Motion |
| --- | --- | --- |
| `#frame-outer` | Black hex frame + shadow | Static |
| `#frame-gold` | Gold trim + side brackets | Sheen pulse (opacity) |
| `#chamber` | Inner dark recess | Static |
| `#gem-outline` | Gem border | Static |
| `#gem-core` | Flame interior | Vertical drift + brightness |
| `#gem-glow` | Outer bloom | Opacity + blur pulse |

## Timeline (2400ms loop)

| Ms | Phase | Action |
| --- | --- | --- |
| 0 / 2400 | Loop seam | Glow 88%, gold dim — must match exactly |
| 0–480 | Anticipation | Glow 60%→85%, chamber warmth +4% |
| 480–1680 | Action | Core drifts −3px, glow peaks 112%, gold sheen sweep |
| 1680–2400 | Settle | Core returns, glow eases to 88% |

Gold sheen starts 120ms after gem glow ramp.

## Easing tokens

```
--p2m-duration: 2400ms
--p2m-ease-in:    cubic-bezier(0.42, 0, 1, 1)
--p2m-ease-out:   cubic-bezier(0, 0, 0.58, 1)
--p2m-ease-inout: cubic-bezier(0.42, 0, 0.58, 1)
--p2m-ease-glow:  cubic-bezier(0.33, 0, 0.2, 1)
```

## Export

```bash
python scripts/export-brand-logo-gif.py
```

Produces `assets/brand/amber-protocol-logo.gif` at 24fps, 58 frames, 320×320.
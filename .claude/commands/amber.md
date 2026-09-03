---
description: Route an Amber task to the right governed journey.
argument-hint: [objective] [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

User input: $ARGUMENTS

# Amber Journey Router

**Index: the seven primary verbs** — `audit`, `init`, `doctor`, `next`, `plan`, `handoff`, `session`

Start from the user's goal, run the deterministic `amber next --objective`
advisor, then continue with exactly one of the four deep journeys:
`amber-diagnosis-adoption`, `amber-delivery`, `amber-context-continuity`, or
`amber-continuous-improvement`. The seven CLI verbs are operator fallback and
debug surfaces, not a second skill topology.

The advisor's `journeyId` comes from `scripts/lib/journey-router.js`; do not
replace route matching with an LLM. A route suggestion is advisory: keep the
human authoritative, and never execute a mutating command merely because the
router selected a journey. Preserve approval, isolation, evidence, and ledger
gates in the selected journey. If no journey matches, ask for the missing goal
or offer the closest read-only diagnosis path instead of sending the user to
the CLI.

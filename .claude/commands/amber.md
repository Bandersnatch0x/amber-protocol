---
description: Route an Amber task to the right governed journey.
argument-hint: [objective] [target]
---

<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->

User input: $ARGUMENTS

# Amber Journey Router

Route the user's request, then tell them which journey is active and follow that journey's process.
The deterministic `amber next --objective` result includes the `journeyId` selected by `scripts/lib/journey-router.js`; do not invent a fifth journey.

If intent spans journeys, start with diagnosis, then delivery. Use context-continuity only when the task needs durable knowledge or a verified Loadout.

For any route choice, run `amber next --objective "<objective>" --target <repo>` and report its deterministic suggestion. Never infer or replace route matching with an LLM. A suggestion is advisory; the human or `session start --route` remains authoritative.

Do not execute a mutating command merely because the router selected a journey. Preserve every approval, isolation, evidence, and ledger gate in the selected journey.

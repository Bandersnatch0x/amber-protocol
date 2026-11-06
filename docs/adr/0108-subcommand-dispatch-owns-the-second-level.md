# ADR-0108: Subcommand Dispatch Owns The Second Level Too

**Status:** Accepted (2026-11-03)
**Date:** 2026-11-03
**Builds on:** [ADR-0028](0028-ledger-family-factory-and-decision-primitives.md) (a family's ritual
belongs in one factory), [ADR-0106](0106-verdict-surfaces-declare-where-not-run-goes.md) (a surface
declares its own vocabulary instead of re-deriving it)

---

## Context

`defineCommand` / `defineCliCommand` (F039) already owned routing, aliases, the result envelope,
exit-code derivation, and the unknown-action guidance. What it did not own was the **second level**:
a command whose actions themselves take verbs.

`harness` is that shape — 23 actions, eight of which carry a second verb (`tool admit`,
`context check`, `checkpoint capture`, `execution cancel`, …), one of which carries a third
(`runtime schedule revoke`). Every one of those handlers re-implemented the same four things:

| Duplication | Count |
| --- | --- |
| `const sub = args._?.[1]` | 10 |
| `else { return invalidArg("harness <group> requires …") }` | 8 |
| `try { … } catch (err) { return writeFailure(err) }` | 18 |
| `return { ...result, text: JSON.stringify(result, null, 2), ok: true }` | 19 |

None of those is domain logic. The third and fourth are the envelope's job, and the factory was
already computing three quarters of that envelope (`errors`/`warnings`/`exitCode`/`bypassPrint`) a
few lines away. The first and second are the factory's job too, but it had no vocabulary for a
group: `defineCliCommand` resolved exactly one positional and stopped.

The cost was not line count. It was locality: to learn what `harness checkpoint verify` does, a
reader had to hold the registry's 40-line usage block, the handler's `args` parsing, the core
module, and the trailing serialization in mind at once — four places, none of which is the answer.
197 test files mention `harness`; three reach this layer directly, because there was no interface
to test through, only a branch.

The same directory also carried 17 copies of `function typedError(code, message)`, each throwing
`new Error(message)`. `core/error-catalog.js` exports a `typedError` that wraps the message in
`codedError` — appending `[CODE] → fix: <remedy>`. Every harness error therefore reached the user
without the remedy the catalog had already written for it, and a new harness module added an
eighteenth copy rather than noticing.

## Decision

1. **A grouped command declares its second level to the dispatcher.** `defineCommand` accepts
   `groups: { name: { actions, unknown } }`. The dispatcher resolves the verb, rejects an unknown or
   missing one, and answers with that group's own guidance text; a handler key becomes the path
   string (`"checkpoint verify"`), so one verb is one handler body.
2. **A group supplies its own guidance wording, not its envelope.** The envelope is the shared
   invalid-argument body (`text: ""`, `errors: [message]`, `exitCode: 1`,
   `code: AMBER_E_INVALID_ARG`), which is what every hand-written `invalidArg` already produced.
   Only the sentence — the part that names the group's real verbs and its Example — stays local.
3. **`data` is the explicit source of the rendered text.** A handler that returns `data` gets
   `text: JSON.stringify(data, null, 2)` in the same trailing slot a hand-written `text:` occupied.
   It is explicit because the substitution has to be exact: some handlers serialized their `result`
   (without `ok`), others serialized their body (with it), and no single implicit rule reproduces
   both. An explicit `text` always wins.
4. **`onError` moves the failure envelope to the boundary.** A handler may throw; the dispatcher
   turns it into the same failure body `writeFailure` produced, for both sync and async handlers.
   Without an `onError` policy a throw propagates exactly as before.
5. **Harness errors are thrown with `core/error-catalog`'s `typedError`.** The 17 local copies are
   deleted; the message now carries the catalog's `[CODE] → fix:` suffix. Codes were already
   registered in `CATALOG`; nothing new was added there.

Three verbs deliberately stay outside a group, and the boundary is part of the decision:

- `runtime` keeps its own `sub`/`op` split: `schedule admit` and `daemon start` differ in argument
  construction, not routing. Flattening them would have split `startDaemon`'s call into pieces
  without removing a single branch.
- `validate` and `replay` treat the second positional as a **fallback run id**
  (`args.run || sub`), not as a verb. Registering them as groups would have rejected
  `amber harness validate <runId>`.
- `legacy` treats a missing verb as valid (the disposition table). A group requires a verb by
  definition.

## Rationale

The factory was already deep; the callers simply could not reach the depth. Extending it was the
small move: `defineCommand` gained three optional fields and kept every existing caller's behaviour
byte for byte (30 modules use it). The alternative — a second factory for grouped commands — would
have created two interfaces for one concept, which is the shape this repository has been removing
(ADR-0028, ADR-0107).

`data` over an implicit rule is the honest version of the same trade. An implicit "serialize the
body" would have silently changed 19 rendered texts in two different directions; naming what to
serialize makes each substitution checkable against the baseline it replaced.

`typedError` is the smallest item here and the one with the clearest deletion test: delete the 17
copies and the complexity does not move anywhere — it was never implementation, only a local
habit that had drifted from the catalog's version.

## Consequences

- `harness-commands.js` drops from 1,175 to 1,101 lines while gaining 16 named handler bodies
  (five groups) and losing 18 `try/catch` shells, 8 hand-written group refusals, and 19
  serialization tails.
- The CLI output of every `harness` action, and of every bare/bogus group invocation, is unchanged.
  This was verified by capturing the baseline from `HEAD`, restoring the working tree, and diffing
  the two runs byte for byte.
- Harness error messages are now longer by the catalog suffix. No existing test asserted the bare
  text; the new test asserts the suffix is present.
- A future grouped command gets routing, guidance, serialization, and error shaping from the same
  place. `runtime` remains the one documented exception, and the reason lives here rather than in a
  comment.

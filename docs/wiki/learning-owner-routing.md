# Learning Owner Routing

Last Reviewed: 2026-08-15

Learning owner routing records which durable Amber surface is responsible for
carrying a learned behavior after a post-accept review. The owner is explicit
accountability metadata. It does not identify the root cause, select a
prevention mechanism, grant execution authority, or schedule work.

## Booking Rule

Every new or replacement booking must name exactly one canonical owner:

```bash
node scripts/amber.js learnings --target . --feature F001 --reviewed --owner command --surface docs/specs/f001.md
```

- `--owner` is mandatory with `--reviewed`.
- Repeated flags, comma-separated owner values, blank values, and unknown IDs
  are rejected before feature state is loaded or written.
- Amber does not infer an owner from changed paths, surfaces, trigger classes,
  or free text. The operator makes and records the routing decision.
- Re-booking is explicit replacement: date, surfaces, and owner are overwritten.
- Historical records with `learningWriteBack.reviewed === true` and no owner
  remain complete. Inspection labels them `legacy`; no migration is required.

## Owner Catalog

The source of truth is
`scripts/lib/core/learning-owner-routing.js`. The table below is parity-tested
against that module, including order and exact wording.

<!-- learning-owner-catalog:start -->
| Owner ID | Decision question | Responsibility |
| --- | --- | --- |
| `skill` | Will the durable behavior primarily teach an agent how to perform a specific task? | Owns instruction documents that guide an agent through a specific task; it does not execute the task. |
| `hook` | Must this behavior be checked at a lifecycle boundary every time that boundary is reached? | Owns deterministic lifecycle reminders, blockers, records, or policy checks at a host boundary. |
| `command` | Is the durable behavior best exposed as a short, fixed operator entry point? | Owns a concise, explicit CLI or manual entry point that invokes a stable operation. |
| `standard` | Is the behavior a reusable set of review checks applied across changes? | Owns reusable review criteria and check collections; it does not itself run a scheduler. |
| `script` | Is the behavior a deterministic extraction, validation, transformation, or formatting helper? | Owns deterministic support logic for extracting, validating, transforming, or formatting data. |
| `workflow-pack` | Should the behavior be carried as a declarative bundle of reusable governance pieces? | Owns declarative bundles that compose skills, standards, scripts, and approval gates without autonomous execution. |
| `loop-contract` | Does the behavior define recurring-work trigger, cadence, state, stop, and review semantics? | Owns declarative repeated-work contracts for trigger, cadence, state spine, hard stops, and review gates; it is not a scheduler. |
| `ci` | Must the check run on a protected repository event or pull-request gate? | Owns continuous checks that actually run on protected repository or PR events; it does not imply general target-project execution. |
<!-- learning-owner-catalog:end -->

## Selection Rule

Choose the smallest real Amber surface that can durably carry the behavior.
Start with each decision question and select the first route whose responsibility
matches the intended artifact and operating boundary. Plausible alternatives do
not justify multiple owners; one booking records one accountable route.

The owner and the reviewed knowledge surface can differ. For example, a review
may be written to `docs/specs/`, while `command` owns the durable operator entry
point that applies the contract.

## Prevention Boundary

F025 `break-loop` analysis and F028 owner routing answer different questions:

- A prevention mechanism records how recurrence will be prevented, such as a
  parity guard or centralized helper.
- A learning owner records where Amber will carry that prevention behavior,
  such as a command, hook, script, or CI check.

Do not copy the F025 prevention taxonomy into owner routing, and do not treat an
owner choice as proof that recurrence has been analyzed.

## Execution Boundary

- `workflow-pack` is a declarative bundle. Selecting it does not dispatch agents,
  schedule work, or execute a target-project command.
- `loop-contract` owns trigger, cadence, state, stop, and review semantics. It is
  not a scheduler and does not make recurring work self-authorizing.
- `ci` applies only when the check actually runs on a protected repository event
  or pull-request gate. A local script that could be called by CI remains
  `script` until that protected-event integration exists.

All routes remain subject to Amber's existing approval, policy, isolation, and
evidence boundaries.

## Drift Symptoms

- CLI help, inspection output, or validator errors list a different owner order.
- The wiki changes an ID, decision question, or responsibility without the core
  catalog changing in the same patch.
- A new booking succeeds without one explicit owner, accepts multiple owners, or
  infers one from paths.
- A legacy ownerless reviewed record is reopened or rewritten.
- `workflow-pack` or `loop-contract` is described as live scheduling, or `ci` is
  selected for a check that does not run on a protected event.

## Test Anchors

- `tests/unit/learning-writeback.test.js` covers taxonomy immutability and order,
  wiki parity, booking cardinality, no-write failures, re-booking, inspection,
  and legacy completion.
- `tests/unit/validators.test.js` covers optional legacy owner metadata and
  canonical validation when the field is present.
- `tests/unit/parse-args.test.js` preserves repeated `--owner` occurrences for
  boundary validation.
- `tests/unit/command-registry-parity.test.js` verifies that help and usage render
  the canonical catalog.

The runtime checkpoint contract is
[Learning Write-Back Checkpoint Contract](../specs/2026-08-15-learning-writeback.md).

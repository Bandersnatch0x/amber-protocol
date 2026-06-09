# Packet B: Implementation

## Task

Implement decision parsing and rendering.

## Requirements

- Parse repeatable `--decision` flags into an array.
- Support `<gate>=<status>` and `<gate>=<status>:<note>`.
- Validate gate ids and statuses.
- Keep unspecified gates pending.
- Preserve explicit no-overwrite behavior.

## Boundary

Decision records are audit artifacts only; they do not execute follow-up work.


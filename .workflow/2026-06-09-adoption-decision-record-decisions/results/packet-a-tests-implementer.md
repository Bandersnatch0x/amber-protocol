# Packet A Tests Result

Status: DONE

## RED Tests

Added tests for:

- explicit decision statuses and notes
- unknown decision gate rejection
- unknown decision status rejection

## RED Evidence

Before implementation:

- explicit decisions were ignored and output stayed `pending`
- unknown gates/statuses were accepted

## Expected Behavior

- Multiple `--decision` flags are accepted.
- Valid decisions are rendered in JSON and markdown.
- Invalid decisions fail without writing output.


# Packet A Tests Result

Status: DONE

## RED Test

Added:

- `adoption decision-record writes pending approval gates from a bundle and refuses overwrite`

The test uses a temporary adoption bundle fixture and asserts:

- JSON kind is `adoption-decision-record`
- target, output path, and gate decision are reported
- approval status is `pending`
- Gate A/B/C decisions exist
- all decisions default to `pending`
- V1 boundaries remain false for target file copy and target command execution
- markdown includes Gate A/B/C and pending status
- overwrite is rejected

## RED Evidence

Before implementation, the test failed because `adoption decision-record` was not routed.


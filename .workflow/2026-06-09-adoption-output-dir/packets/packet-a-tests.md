# Packet A: Tests

Objective: define `adoption report --output-dir` behavior before implementation.

Expected output:

- CLI test fails because `--output-dir` is not implemented.
- Test proves two report runs produce two different files and do not touch target root files.


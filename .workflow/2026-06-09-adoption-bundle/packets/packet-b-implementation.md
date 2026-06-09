# Packet B - Implementation

Implementer task:

- Add bundle helper in `scripts/lib/harness-core.js`.
- Add `adoption bundle` CLI route.
- Create required files and manifest.
- Refuse existing output directory.

Spec review must confirm:

- Bundle reads adoption artifacts only.
- No target project files are copied.
- Manifest records safety boundaries.

Quality review must confirm:

- Implementation reuses adoption status/index/diff/gate builders where possible.
- Existing command outputs remain stable.

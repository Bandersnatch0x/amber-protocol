# Examples

This directory contains real-project adoption artifacts.

- `stockagents-adoption-walkthrough.md`: narrative walkthrough for the StockAgents trial.
- `stockagents-adoption-report.md`: fixed-path report generated with `adoption report --output`.
- `adoptions/`: timestamped reports generated with `adoption report --output-dir`.
- `adoptions-index.md`: markdown index generated with `adoption index --reports-dir adoptions --output adoptions-index.md`.
- `stockagents-adoption-diff.md`: markdown diff generated with `adoption compare --base ... --head ... --output stockagents-adoption-diff.md`.
- `stockagents-adoption-gate.md`: readiness gate generated with `adoption gate --reports-dir adoptions --output stockagents-adoption-gate.md`.
- `stockagents-adoption-status.md`: rollup generated with `adoption status --reports-dir adoptions --index adoptions-index.md --output stockagents-adoption-status.md`.
- `stockagents-adoption-bundle/`: review bundle generated with `adoption bundle --reports-dir adoptions --index adoptions-index.md --output-dir stockagents-adoption-bundle`.
- `stockagents-adoption-next-actions.md`: read-only gate-resolution checklist generated from the StockAgents adoption bundle.

Generated adoption reports are review artifacts. They do not imply that the target project was initialized, upgraded, or tested. `adoption list`, `adoption validate`, `adoption compare --reports-dir`, `adoption gate --reports-dir`, and `adoption status --reports-dir` are read-only. `adoption index`, `adoption compare --output`, `adoption gate --output`, and `adoption status --output` require explicit output paths that do not already exist. `adoption bundle --output-dir` also requires a directory that does not already exist and writes only the bundle directory.

Validate these artifacts with:

```sh
node ../../scripts/harness.js adoption validate --reports-dir adoptions --index adoptions-index.md
node ../../scripts/harness.js adoption compare --reports-dir adoptions
node ../../scripts/harness.js adoption gate --reports-dir adoptions
node ../../scripts/harness.js adoption status --reports-dir adoptions --index adoptions-index.md
node ../../scripts/harness.js adoption bundle --reports-dir adoptions --index adoptions-index.md --output-dir stockagents-adoption-bundle-review
```

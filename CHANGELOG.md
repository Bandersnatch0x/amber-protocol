# Changelog

All notable changes to Amber Protocol will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Refactored README.md and README.zh-CN.md for adopter-first clarity (388→134 lines, −65%)
  - Streamlined to 7-section structure: value proposition, installation, quick start, core concepts, boundaries, documentation, contributing
  - Removed duplicate control layers table and command surface (moved to CLI_REFERENCE.md)
  - Added milestone & test status link to status line
  - Changed quick start example from `path/to/repo` to `my-project`
  - Eliminated drift between English and Chinese versions

### Fixed
- Corrected `docs/README.md` path reference: `guides/getting-started.md` → `user-guide/getting-started.md`

### Added
- Banner regeneration prompt at `assets/readme/BANNER_PROMPT.md`

## [1.0.0] - 2026-06-22

### Added
- Core Amber Protocol engine (init, audit, doctor, adoption)
- Route definitions for feature/bugfix/refactor workflows
- Session lifecycle management with checkpoints and timelines
- Web viewer (beta, local-only)
- Comprehensive test suite (900+ assertions, 281 web tests)
- CI/CD pipeline with quality gates (coverage, security, performance)

### Changed
- Rebranded from Coding Harness to Amber Protocol
- Reorganized documentation by functional topics (removed phase concept)

### Documentation
- Getting started guide
- Architecture documentation (route engine, session lifecycle, governance)
- Adoption workflow for existing projects
- API reference

### Security
- Path traversal protection in session/gate readers
- Secret redaction in client error reports
- Upgraded Nodemailer to 9.0.1 to resolve GHSA-p6gq-j5cr-w38f

## [1.0.0-rc.1] - 2026-06-21

### Added
- Release candidate for community testing
- Release checklist documentation for quality assurance
- Docker isolation testing for npm package
- GPG-signed release tags
- RC validation report template

---

[Unreleased]: https://github.com/Bandersnatch0x/amber-protocol/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.0.0
[1.0.0-rc.1]: https://github.com/Bandersnatch0x/amber-protocol/releases/tag/v1.0.0-rc.1

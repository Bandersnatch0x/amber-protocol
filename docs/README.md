# Amber Protocol Documentation

Welcome to the **Amber Protocol** documentation. This is your central navigation hub for all project documentation.

## 📚 Documentation Index

### 🚀 Getting Started

New to Amber Protocol? Start here:

- **[Getting Started Guide](./guides/getting-started.md)** - Installation, quick start, and basic usage
- **[CLI Reference](./CLI_REFERENCE.md)** - Complete command-line interface documentation
- **[Deployment Guide](./DEPLOYMENT.md)** - Web viewer deployment instructions

### 🏗️ Architecture & Design

Understand how Amber Protocol works:

- **[Architecture Overview](./architecture/)** - System design and control layers
- **[Architecture Decision Records (ADRs)](./adr/)** - Design decisions and rationale
- **[Specifications](./specs/)** - Technical specifications and contracts
- **[Ubiquitous Language](../UBIQUITOUS_LANGUAGE.md)** - Domain terminology and concepts

### 📖 User Guides

Detailed guides for specific use cases:

- **[Autonomous Mode Guide](./AUTONOMOUS_MODE_GUIDE.md)** - Using autonomous session execution
- **[Policy Configuration](./POLICY_CONFIGURATION.md)** - Configuring governance policies
- **[Notification Setup](./NOTIFICATION_SETUP.md)** - Setting up notifications
- **[Monitoring Setup](./MONITORING_SETUP.md)** - Production monitoring configuration
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues and solutions

### 🔧 Development

For contributors and advanced users:

- **[Contributing Guide](../CONTRIBUTING.md)** - Development setup and contribution guidelines
- **[Release Guide](../RELEASE_GUIDE.md)** - Release process and versioning
- **[Agent Instructions](./agents/)** - Agent-facing documentation
- **[Superpowers](./superpowers/)** - Advanced workflow capabilities

### 🧪 Quality & Testing

Quality standards and release criteria:

- **[Core Use Cases](./quality/core-use-cases.md)** - Critical functionality requirements
- **[Coverage Baseline](./quality/coverage-baseline.md)** - Test coverage standards
- **[RC Validation Report](./quality/rc-validation-report.md)** - Release candidate validation
- **[Release Checklist](./quality/release-checklist.md)** - Pre-release verification steps
- **[Rollback Procedures](./quality/rollback-procedures.md)** - Emergency rollback procedures

### 📋 Reference

Technical references and specifications:

- **[API Reference](./api/)** - API documentation and schemas
- **[Route System](./reference/)** - Route engine and workflow definitions
- **[Wiki Template](./wiki/)** - Project context documentation structure
- **[Examples](./examples/)** - Real-world usage examples and patterns

### 🔍 Reviews & Analysis

Architecture reviews and design analysis:

- **[Reviews Directory](./reviews/)** - Architecture and code reviews
- **[Product Definition](../PRODUCT.md)** - Product vision and boundaries
- **[Roadmap](../ROADMAP.md)** - Future development plans

### 🕰️ Legacy & Migration

Historical context and migration guides:

- **[Legacy Documentation](./legacy/)** - Archived documentation from coding-harness era
- **[Migration Guides](../src/migration/)** - Migrating from legacy formats

## 📦 Quick Links

### Common Tasks

- **Install Amber**: `npm install -g amber-protocol`
- **Initialize repo**: `amber init --target .`
- **Start session**: `amber session start --goal "your goal"`
- **Launch web viewer**: `cd apps/web && npm run dev`
- **Run tests**: `npm test`
- **Generate handoff**: `amber handoff --target .`

### Key Files

- **[README.md](../README.md)** - Project overview and quick start
- **[CHANGELOG.md](../CHANGELOG.md)** - Version history and changes
- **[CLAUDE.md](../CLAUDE.md)** - Claude Code integration instructions
- **[AGENTS.md](../AGENTS.md)** - Agent collaboration guidelines

## 🎯 Documentation by Role

### For End Users

1. [Getting Started](./guides/getting-started.md)
2. [CLI Reference](./CLI_REFERENCE.md)
3. [Troubleshooting](./TROUBLESHOOTING.md)

### For Project Adopters

1. [Getting Started](./guides/getting-started.md)
2. [Adoption Examples](./examples/)
3. [Policy Configuration](./POLICY_CONFIGURATION.md)
4. [Wiki Template](./wiki/)

### For Contributors

1. [Contributing Guide](../CONTRIBUTING.md)
2. [Architecture Overview](./architecture/)
3. [Quality Standards](./quality/)
4. [ADRs](./adr/)

### For DevOps/SREs

1. [Deployment Guide](./DEPLOYMENT.md)
2. [Monitoring Setup](./MONITORING_SETUP.md)
3. [Troubleshooting](./TROUBLESHOOTING.md)
4. [Rollback Procedures](./quality/rollback-procedures.md)

## 📊 Documentation Statistics

- **Total documentation files**: 106 markdown files
- **Current version**: 1.0.0-rc.1
- **Status**: Release Candidate
- **Last updated**: 2026-06-21

## 🔄 Documentation Maintenance

This documentation is actively maintained. If you find:

- **Broken links** - Run `node scripts/check-broken-links.js`
- **Outdated content** - File an issue or submit a PR
- **Missing documentation** - Open a GitHub discussion

## 📞 Support

- **Documentation issues**: [GitHub Issues](https://github.com/Bandersnatch0x/amber-protocol/issues)
- **Feature requests**: [GitHub Discussions](https://github.com/Bandersnatch0x/amber-protocol/discussions)
- **Community chat**: Coming soon

## 📄 License

All documentation is licensed under MIT. See [LICENSE](../LICENSE) for details.

---

**Amber Protocol** - Repository-local AI coding governance for engineering teams.

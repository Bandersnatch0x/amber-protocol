---
id: wiki
title: "Structured Wiki & Knowledge Base"
sidebar_label: "Structured Wiki"
description: "The OKF-compliant wiki model, knowledge plans, and document distillation."
---

# Structured Wiki & Knowledge Base

Amber provides a **Structured Wiki** subsystem adhering to the Open Knowledge Format (OKF) standard. It enables teams to maintain curated documentation alongside machine-actionable distillation contracts.

## OKF Compliance

The OKF specification standardizes markdown wiki pages through:
- Strict frontmatter schemas (`type`, `status`, `created`, `updated`, `domain`, `tags`)
- Deterministic cross-page reference linking
- Automated linting via `amber wiki --okf`

## Knowledge Plans

A Knowledge Plan (`docs/wiki/knowledge-plan.json`) declaratively models documentation requirements across a codebase:
- Declared documents and concepts
- Knowledge cards and distillation contracts
- Coverage reporting against codebase components

```bash
# Scaffold knowledge plan
amber wiki knowledge scaffold --target .

# Validate wiki conformity
amber wiki knowledge validate --target .

# Report documentation coverage
amber wiki knowledge report --target .
```

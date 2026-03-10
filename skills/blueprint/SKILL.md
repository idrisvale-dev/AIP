---
name: blueprint
description: >-
  Turn a one-line objective into a step-by-step construction plan for
  multi-session, multi-agent engineering projects. Each step has a
  self-contained context brief so a fresh agent can execute it cold.
  Includes adversarial review gate, dependency graph, parallel step
  detection, anti-pattern catalog, and plan mutation protocol.
  TRIGGER when: user requests a plan, blueprint, or roadmap for a
  complex multi-PR task, or describes work that needs multiple sessions.
  DO NOT TRIGGER when: task is completable in a single PR or fewer
  than 3 tool calls, or user says "just do it".
origin: community
---

# Blueprint — Construction Plan Generator

Turn a one-line objective into a step-by-step construction plan that any coding agent can execute cold.

```
/blueprint myapp "migrate database to PostgreSQL"
```

## What You Get

A Markdown plan file in `plans/` where every step is independently executable — a fresh agent in a new session can pick up any step without reading prior steps or conversation history:

- **Steps** — each one-PR sized, with task list, rollback strategy, verification commands, and exit criteria
- **Dependency graph** — which steps can run in parallel, which must be serial
- **Design decisions** — rationale for key choices, locked against re-litigation
- **Invariants** — properties verified after every step
- **Progress log** — single source of truth for execution state across sessions
- **Review log** — findings from an adversarial review gate

## Installation

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/antbotlab/blueprint.git ~/.claude/skills/blueprint
```

## Usage

```
/blueprint <project> <objective>
```

## Key Features

**Cold-start execution** — Every step includes a self-contained context brief. No prior context needed.

**Adversarial review gate** — Every plan is reviewed by a strongest-model sub-agent (e.g., Opus) against a checklist covering completeness, dependency correctness, and anti-pattern detection.

**Branch/PR/CI workflow** — Built into every step. Detects git/gh availability and degrades gracefully to direct mode when absent.

**Parallel step detection** — Dependency graph identifies steps with no shared files or output dependencies.

**Zero runtime risk** — Pure markdown skill. No hooks, no shell scripts, no executable code. No attack surface.

**Plan mutation protocol** — Steps can be split, inserted, skipped, reordered, or abandoned with formal protocols and audit trail.

## Requirements

- Claude Code (for `/blueprint` slash command)
- Git + GitHub CLI (optional — enables full branch/PR/CI workflow; Blueprint detects absence and auto-switches to direct mode)

## Source

[github.com/antbotlab/blueprint](https://github.com/antbotlab/blueprint) — MIT License

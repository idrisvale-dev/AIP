# Working Context

Last updated: 2026-03-31

## Purpose

Public ECC plugin repo for agents, skills, commands, hooks, rules, install surfaces, and ECC 2.0 platform buildout.

## Current Truth

- Default branch: `main`
- Immediate blocker addressed: CI lockfile drift and hook validation breakage fixed in `a273c62`
- Local full suite status after fix: `1723/1723` passing
- Main active operational work:
  - keep default branch green
  - audit and classify remaining open PR backlog by full diff
  - continue ECC 2.0 control-plane and operator-surface buildout

## Current Constraints

- No merge by title or commit summary alone.
- No arbitrary external runtime installs in shipped ECC surfaces.
- Overlapping skills, hooks, or agents should be consolidated when overlap is material and runtime separation is not required.

## Active Queues

- PR backlog: audit and classify remaining open PRs into merge, port/rebuild, close, or park
- Product:
  - selective install cleanup
  - control plane primitives
  - operator surface
  - self-improving skills
- Security:
  - keep dependency posture clean
  - preserve self-contained hook and MCP behavior

## Open PR Classification

- Merge candidate after full diff audit:
  - `#1064` `chore(deps-dev): bump @eslint/js from 9.39.2 to 10.0.1`
- Close or supersede:
  - `#1063` `chore(deps-dev): bump eslint from 9.39.2 to 10.1.0`
- Park pending audit / bundle-policy review:
  - `#1069` `feat: add everything-claude-code ECC bundle`
  - `#1068` `feat: add everything-claude-code-conventions ECC bundle`
- Port or rebuild inside ECC after full audit:
  - `#1055` Dart / Flutter support
  - `#1043` C# reviewer and .NET skills
  - `#894` Jira integration
  - `#852` openclaw-user-profiler
  - `#851` openclaw-soul-forge
  - `#844` ui-demo skill
  - `#834` localized catalog sync and antigravity target filtering
  - `#814` session completion summary notifications
  - `#808` desktop notifications
  - `#640` harper skills

## Interfaces

- Public truth: GitHub issues and PRs
- Internal execution truth: linked Linear work items under the ECC program
- Current linked Linear items:
  - `ECC-206` ecosystem CI baseline
  - `ECC-207` PR backlog audit and merge-policy enforcement
  - `ECC-208` context hygiene

## Update Rule

Keep this file detailed for only the current sprint, blockers, and next actions. Summarize completed work into archive or repo docs once it is no longer actively shaping execution.

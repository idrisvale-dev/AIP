---
name: nextjs-turbopack
description: Next.js 16+ and Turbopack — incremental bundling, FS caching, dev speed, and when to use Turbopack vs webpack.
origin: ECC
---

# Next.js and Turbopack

Next.js 16+ uses Turbopack by default for local development: an incremental bundler written in Rust that significantly speeds up dev startup and hot updates. Use this skill when working with Next.js 16+ or tuning build performance.

## Core Concepts

- **Turbopack**: Incremental bundler for Next.js dev. Uses file-system caching so restarts are much faster (e.g. 5–14x on large projects).
- **Default in dev**: From Next.js 16, `next dev` runs with Turbopack unless disabled.
- **Production**: Next.js production builds still use the existing production bundler (webpack-based); Turbopack is focused on dev today.

## When to Use Turbopack vs Webpack

- **Turbopack (default dev)**: Use for day-to-day development. Faster cold start and HMR, especially in large apps.
- **Webpack (legacy dev)**: Use only if you hit a Turbopack bug or rely on a webpack-only plugin in dev. Disable with env or flag (e.g. `--no-turbopack` if your version supports it).
- **Production**: No change; production build pipeline is unchanged.

## Commands

```bash
# Dev with Turbopack (Next.js 16+ default)
next dev

# Build (unchanged; not Turbopack)
next build

# Start production server
next start
```

## File-System Caching

Turbopack caches work on disk so that:

- Restarts reuse previous work; second run is much faster.
- Large projects see 5–14x faster compile times on restart in practice.
- Cache is typically under `.next` or a similar project-local directory; no extra config needed for basic use.

## Bundle Analyzer (Next.js 16.1+)

Next.js 16.1 introduced an experimental Bundle Analyzer to inspect output and find heavy dependencies:

- Enable via config or experimental flag (see Next.js docs for your version).
- Use to optimize code-splitting and trim large dependencies.

## Best Practices

- Stay on a recent Next.js 16.x for stable Turbopack and caching behavior.
- If dev is slow, ensure you're on Turbopack (default) and that the cache isn't being cleared unnecessarily.
- For production bundle size issues, use the Bundle Analyzer and `next/bundle-analysis` or equivalent tooling.
- Prefer App Router and server components where possible; they align with current Next.js and Turbopack optimizations.

## When to Use This Skill

Use when: developing or debugging Next.js 16+ apps, diagnosing slow dev startup or HMR, or optimizing production bundles with Next.js tooling.

---
name: bun-runtime
description: Bun as runtime, package manager, bundler, and test runner. When to choose Bun vs Node, migration notes, and Vercel support.
origin: ECC
---

# Bun Runtime

Bun is a fast all-in-one JavaScript runtime and toolkit: runtime, package manager, bundler, and test runner. Use this skill when working in or migrating to Bun.

## Core Concepts

- **Runtime**: Drop-in Node-compatible runtime (built on JavaScriptCore, implemented in Zig).
- **Package manager**: `bun install` is significantly faster than npm/yarn; lockfile is `bun.lockb`.
- **Bundler**: Built-in bundler and transpiler for apps and libraries.
- **Test runner**: Built-in `bun test` with Jest-like API.

## When to Use Bun vs Node

- **Prefer Bun** for: new JS/TS projects, scripts where install/run speed matters, Vercel deployments with Bun runtime, and when you want a single toolchain (run + install + test + build).
- **Prefer Node** for: maximum ecosystem compatibility, legacy tooling that assumes Node, or when a dependency has known Bun issues.

## Quick Reference

### Run and install

```bash
# Install dependencies (creates/updates bun.lockb)
bun install

# Run a script (package.json "scripts" or direct file)
bun run dev
bun run src/index.ts

# Run a file directly
bun src/index.ts
```

### Scripts and env

```bash
# Load .env and run
bun run --env-file=.env dev

# Inline env
FOO=bar bun run script.ts
```

### Testing

```bash
# Run tests (Jest-like API)
bun test

# Watch mode
bun test --watch
```

```typescript
// test/example.test.ts
import { expect, test } from "bun:test";

test("add", () => {
  expect(1 + 2).toBe(3);
});
```

### API (runtime)

```typescript
// File I/O (Bun-native, fast)
const file = Bun.file("package.json");
const json = await file.json();

// HTTP server
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello");
  },
});
```

## Migration from Node

- Replace `node script.js` with `bun run script.js` or `bun script.js`.
- Run `bun install` in place of `npm install`; most packages work. If something fails, try `bun install --backend=hardlink` or report upstream.
- Use `bun run` for npm scripts; `bun x` for npx-style one-off runs (e.g. `bun x prisma generate`).
- Node built-ins (`fs`, `path`, `http`, etc.) are supported; prefer Bun APIs where they exist for better performance.

## Vercel and deployment

- Vercel supports the Bun runtime. Set runtime to Bun in project settings or use the Bun build preset where available.
- Build command: often `bun run build` or `bun build ./src/index.ts --outdir=dist`.
- Install command: `bun install --frozen-lockfile` for reproducible deploys.

## Best Practices

- Use `bun.lockb` and commit it for reproducible installs.
- Prefer `bun run` for scripts so env and lifecycle are consistent.
- For TypeScript, Bun runs `.ts` natively; no separate `ts-node` needed.
- Keep dependencies up to date; Bun and the ecosystem evolve quickly.

## When to Use This Skill

Use when: adopting Bun, migrating from Node, writing or debugging Bun scripts/tests, or configuring Bun on Vercel or other platforms.

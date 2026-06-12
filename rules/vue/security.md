---
paths:
  - "**/*.vue"
  - "**/components/**/*.ts"
  - "**/composables/**/*.ts"
  - "**/pages/**/*.vue"
  - "**/server/**/*.ts"
---
# Vue Security

> This file extends [typescript/security.md](../typescript/security.md) and [common/security.md](../common/security.md) with Vue-specific security rules.

## XSS via `v-html`

CRITICAL. `v-html` sets `innerHTML` directly — Vue deliberately named it to look dangerous.

```vue
<!-- CRITICAL: unsanitized user input -->
<div v-html="userBio" />

<!-- CORRECT: render as text -->
<div>{{ userBio }}</div>

<!-- CORRECT: sanitize first -->
<script setup>
import DOMPurify from "dompurify";
const sanitizedBio = computed(() => DOMPurify.sanitize(userBio.value));
</script>
<template>
  <div v-html="sanitizedBio" />
</template>
```

Audit checklist for every `v-html` usage:

- Is the input always under our control? Document the source.
- If user-derived: is it sanitized at the same call site?
- Is the sanitizer allowlisting tags, not denylisting?
- Consider `eslint-plugin-vue` rule `vue/no-v-html` to flag all usages.

## Unsafe URL Bindings

```vue
<!-- CRITICAL: unsafe URL from user input -->
<a :href="user.website">Visit</a>
<iframe :src="user.providedUrl" />

<!-- CORRECT: validate scheme -->
<script setup lang="ts">
function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
</script>
<template>
  <a v-if="safeUrl(user.website)" :href="safeUrl(user.website)">Visit</a>
</template>
```

## Template Injection via Interpolation

Vue template interpolation (`{{ }}`) automatically escapes HTML entities — this is safe. The risk is `v-html` (covered above) and any custom directive that manipulates `innerHTML` directly.

```ts
// Suspicious: custom directive manipulating innerHTML
app.directive("render-html", (el, binding) => {
  el.innerHTML = binding.value; // Same risk as v-html
});
```

## Secret Exposure via Environment Variables

| Framework | Public prefix | Private |
|-----------|---------------|---------|
| Vite | `VITE_*` | Others |
| Nuxt | `public` in `runtimeConfig` | Server-side only |
| Vue CLI | `VUE_APP_*` | Others |
| Custom (import.meta.env) | Any exposed via Vite `define` | Not configured |

```ts
// CRITICAL: secret leaked to client bundle (Vite)
const apiKey = import.meta.env.VITE_STRIPE_SECRET; // FAIL VITE_ prefix = public

// CORRECT: server-side only
// vite.config.ts — never pass VITE_ prefixed secrets
```

### Nuxt Runtime Config

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    // Server-side only — never exposed to client
    stripeSecret: "",

    // Public — exposed to client, treat as public
    public: {
      apiBase: "https://api.example.com",
      // NEVER put secrets here
    },
  },
});
```

### SSR Hydration Mismatch (Vue 3.5+)

If server and client render different values for the same DOM node (e.g., locale-dependent date formatting), use `data-allow-mismatch` to suppress the warning rather than suppressing legitimate differences:

```vue
<span data-allow-mismatch="text">{{ date.toLocaleString() }}</span>
```

Do NOT use `data-allow-mismatch` to hide real security issues like missing auth checks or mismatched auth state.

## Server API Input Validation (Nuxt Nitro)

```ts
// server/api/users/[id].ts
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  // Validate route params
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse);

  // Validate query
  const query = await getValidatedQuery(event, z.object({
    include: z.string().optional(),
  }).parse);

  // Validate body (for POST/PUT)
  const body = await readValidatedBody(event, z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  }).safeParse);

  if (!body.success) {
    throw createError({ statusCode: 400, message: body.error.message });
  }

  // ... proceed with validated data
});
```

- **Never trust `event.node.req` raw properties** — use Nitro's `getValidatedRouterParams`, `readValidatedBody`, `getValidatedQuery`.
- Server routes with write operations must validate authentication and authorization.
- Rate-limit sensitive endpoints.

## `localStorage` / `sessionStorage`

```ts
// CRITICAL: session tokens in localStorage
localStorage.setItem("token", jwt); // FAIL any XSS can read this

// CORRECT: httpOnly cookie set by server
// Client never touches the token directly.
```

In SSR (Nuxt), `localStorage` does not exist on the server — accessing it unconditionally crashes.

```ts
// CORRECT: guard browser-only APIs
if (import.meta.client) {
  const theme = localStorage.getItem("theme");
}
```

## `target="_blank"`

```vue
<!-- WRONG -->
<a :href="externalUrl" target="_blank">External</a>

<!-- CORRECT -->
<a :href="externalUrl" target="_blank" rel="noopener noreferrer">External</a>
```

Modern browsers default to `noopener`, but explicit is safer.

## Third-Party Vue Libraries

- Audit `npm audit` before adding any UI library.
- Check that component libraries do not internally use `v-html` or `innerHTML` on user input.
- Pin versions, review changelogs before major upgrades.
- Be wary of rich-text/WYSIWYG editor components — they must sanitize HTML input.

## Content Security Policy (CSP)

Minimum acceptable CSP for a Vue SPA:

```
default-src 'self';
script-src 'self' 'nonce-{REQUEST_NONCE}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' https://api.example.com;
frame-ancestors 'none';
```

- For SSR (Nuxt), use per-request nonces via `useHead` / `useServerHead`.
- Avoid `'unsafe-eval'` — Vue does not need it (unlike older Angular).
- `style-src 'unsafe-inline'` is often required for `<style>` in SFCs and CSS-in-JS.

## Authentication & Authorization

- Never store session tokens in `localStorage` / `sessionStorage`.
- Route guards (`beforeEach`) are UI gating only — every API endpoint must independently authorize.
- Pinia stores that cache user roles/permissions must invalidate on logout.

## Prototype Pollution

```ts
// WRONG: spreading untrusted data
const update = await req.json();
Object.assign(state, update); // attacker controls keys

// CORRECT: whitelist keys
const allowed = ["name", "email"];
const safe: Record<string, unknown> = {};
for (const key of allowed) {
  if (key in update) safe[key] = update[key];
}
Object.assign(state, safe);
```

## Source Maps in Production

Production Vite builds should not ship source maps, or upload them to an error tracker and strip from public bundles.

```ts
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: process.env.NODE_ENV === "development",
  },
});
```

## Agent Support

- Use `security-reviewer` agent for comprehensive security audits across the codebase.
- Use `vue-reviewer` agent for Vue-specific patterns and the above rules in active code review.

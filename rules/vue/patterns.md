---
paths:
  - "**/*.vue"
  - "**/components/**/*.ts"
  - "**/composables/**/*.ts"
  - "**/stores/**/*.ts"
  - "**/pages/**/*.vue"
---
# Vue Patterns

> This file extends [typescript/patterns.md](../typescript/patterns.md) and [common/patterns.md](../common/patterns.md) with Vue-specific architecture patterns. For composable rules see [hooks.md](./hooks.md).

## Component Design Principles

### Presentational vs Container

Split large views into container (data-fetching, state, orchestration) and presentational (props-in, events-out) components.

```vue
<!-- Container: src/pages/UserList.vue -->
<script setup lang="ts">
const { users, isLoading } = useUsers();
</script>
<template>
  <UserListSkeleton v-if="isLoading" />
  <UserTable v-else :users="users" @select="handleSelect" />
</template>

<!-- Presentational: src/components/UserTable.vue -->
<script setup lang="ts">
defineProps<{ users: User[] }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>
<template>
  <div v-for="user in users" :key="user.id" @click="emit('select', user.id)">
    {{ user.name }}
  </div>
</template>
```

### Provide / Inject

Use for dependency injection (not state management). Ideal for: theme, locale, configuration, plugin API surfaces.

```ts
// Provider — in a parent or plugin
const theme = ref<Theme>("light");
provide("theme", readonly(theme));

// Consumer — in any descendant
const theme = inject<Ref<Theme>>("theme");
```

- Always use `readonly()` when providing to prevent child mutations.
- Use `Symbol` keys for injection to avoid name collisions.
- Document the injection key type with a shared constant.

### Scoped Slots

Use scoped slots when a child component owns data but the parent controls rendering.

```vue
<!-- Child -->
<template>
  <ul>
    <li v-for="item in items" :key="item.id">
      <slot name="item" :item="item" :index="index" />
    </li>
  </ul>
</template>

<!-- Parent -->
<template>
  <DataList :items="users">
    <template #item="{ item, index }">
      <UserCard :user="item" :rank="index + 1" />
    </template>
  </DataList>
</template>
```

## State Management

### Decision Tree

1. **Component-local**: `ref()` / `reactive()` inside the component
2. **Shared between parent + few children**: Lift to parent, pass via props + emits
3. **Shared across distant branches, infrequent updates**: `provide` / `inject`
4. **Global, shared, complex**: Pinia store
5. **Server-derived data**: Composables wrapping `fetch` / `useFetch` (Nuxt) / TanStack Query (Vue Query)

### Pinia Patterns

```ts
// stores/useUserStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { getUser, updateUser } from "@/api/user";

export const useUserStore = defineStore("user", () => {
  // State
  const currentUser = ref<User | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  // Getters (computed)
  const isLoggedIn = computed(() => currentUser.value !== null);
  const displayName = computed(() =>
    currentUser.value ? currentUser.value.name : "Guest"
  );

  // Actions
  async function fetchUser(id: string) {
    isLoading.value = true;
    error.value = null;
    try {
      currentUser.value = await getUser(id);
    } catch (e) {
      error.value = e as Error;
    } finally {
      isLoading.value = false;
    }
  }

  return { currentUser, isLoading, error, isLoggedIn, displayName, fetchUser };
});
```

- Prefer **Setup Store** syntax (Composition API) over Options Store.
- Store actions are the ONLY place to mutate state — no direct `store.$patch` in components for complex logic.
- Every async action must handle loading, success, and error states.
- Keep stores focused on one domain — split auth, user, cart, etc. into separate stores.

## Vue Router Patterns

### Navigation Guards

```ts
// Global guard
router.beforeEach((to, from) => {
  const store = useUserStore();
  if (to.meta.requiresAuth && !store.isLoggedIn) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
});
```

- Always provide a redirect path so the user returns to their intended destination after login.
- Route guards should not have side effects beyond navigation decisions.
- Use `beforeEnter` on routes for route-specific checks; `beforeEach` for global ones.

### Lazy Loading

```ts
const routes = [
  {
    path: "/dashboard",
    component: () => import("@/pages/Dashboard.vue"), // lazy
  },
  {
    path: "/settings",
    component: () => import("@/pages/Settings.vue"),
    // Provide loading/error components
    meta: {
      __loadingComponent: LoadingSpinner,
      __errorComponent: ErrorView,
    },
  },
];
```

### Route Params inside Same Component

```vue
<script setup lang="ts">
// WRONG: snapshot
const { id } = useRoute().params;
watch(id, fetchItem); // id is a plain string — doesn't change

// CORRECT: ref-wrapped
const route = useRoute();
const id = computed(() => route.params.id as string);
watch(id, fetchItem);

// ALSO CORRECT: watch the route
watch(() => route.params.id, fetchItem);
</script>
```

## List Rendering

### `v-for` with Stable Keys

```vue
<!-- CORRECT: stable unique ID -->
<div v-for="item in items" :key="item.id">
  {{ item.name }}
</div>

<!-- WRONG: index as key (breaks on reorder/insert/delete) -->
<div v-for="(item, index) in items" :key="index">
  {{ item.name }}
</div>

<!-- WRONG: v-if + v-for on same element -->
<div v-for="item in items" v-if="item.active" :key="item.id">
  <!-- v-if runs on item, but intention is to filter the list -->
</div>

<!-- CORRECT: computed filtered list -->
<script setup>
const activeItems = computed(() => items.value.filter(i => i.active));
</script>
<template>
  <div v-for="item in activeItems" :key="item.id">{{ item.name }}</div>
</template>
```

## Forms

### v-model Patterns

```vue
<script setup lang="ts">
// Basic binding
const name = ref("");

// Multiple v-model (Vue 3.4+ defineModel)
const model = defineModel<string>();
const title2 = defineModel<string>("title");

// With validator/transformer
const price = defineModel<number>({ required: true });
</script>

<template>
  <input v-model="name" />
  <CustomInput v-model="model" v-model:title="title2" />
</template>
```

### Form Validation

For non-trivial forms, use a vetted library:

- **VeeValidate** — declarative validation rules, form-level context.
- **FormKit** — schema-based forms with built-in validation.
- **Custom with composable** — for simple cases only.

```ts
// Anti-pattern: manual validation in component
const errors = ref<string[]>([]);
function submit() {
  errors.value = [];
  if (!email.value.includes("@")) errors.value.push("Invalid email");
  // ... fragile, not reusable, no i18n
}
```

### Event Handling

```vue
<!-- Prefer @submit.prevent on form element -->
<form @submit.prevent="handleSubmit">
  <button type="submit">Save</button>
</form>

<!-- Key modifiers -->
<input @keyup.enter="submit" />
<input @keyup.esc="cancel" />

<!-- Event modifiers chaining -->
<a @click.prevent.stop="handleClick">Link</a>
```

## Scoped CSS

```vue
<style scoped>
/* Styles are scoped to this component via data-v-* attributes */
.card {
  padding: 16px;
}
</style>
```

- Always use `<style scoped>` for component styles — prevents leakage.
- For child component root element styling, use `:deep()` combinator.
- For slot content styling, use `:slotted()`.
- For global overrides, use a separate `<style>` block (no scoped) sparingly.

```vue
<style scoped>
/* Target child root element */
.card :deep(.title) { font-size: 20px; }

/* Target slot content */
:slotted(p) { margin: 0; }
</style>
```

## Teleport

Use `<Teleport>` for modals, tooltips, notifications — content that must escape parent overflow/z-index constraints.

```vue
<template>
  <Teleport to="body">
    <Modal :show="isOpen" @close="isOpen = false">
      <slot />
    </Modal>
  </Teleport>
</template>
```

**Vue 3.5+**: `<Teleport>` supports `defer` prop for deferred mounting. This allows teleporting to a target element that is rendered later in the same render cycle:

```vue
<!-- defer: target can appear after the Teleport in the DOM -->
<Teleport defer to="#container">
  <p>Teleported content</p>
</Teleport>
<div id="container"></div>
```

## KeepAlive

Cache component state when toggling between views. Always set `:max` to control memory.

```vue
<template>
  <KeepAlive :max="10">
    <component :is="currentTab" />
  </KeepAlive>
</template>
```

## `useId()` (Vue 3.5+)

Generate unique, SSR-stable IDs for form elements and accessibility attributes:

```vue
<script setup>
import { useId } from "vue";
const id = useId();
</script>
<template>
  <label :for="id">Name:</label>
  <input :id="id" type="text" />
</template>
```

- IDs are unique per application instance and stable across server/client rendering.
- Prefer `useId()` over manual ID generation to avoid SSR hydration mismatches.

## `data-allow-mismatch` (Vue 3.5+)

Suppress unavoidable server/client value mismatch warnings:

```vue
<span data-allow-mismatch>{{ date.toLocaleString() }}</span>
<!-- Optional: restrict to specific mismatch types -->
<span data-allow-mismatch="text">{{ clientOnlyValue }}</span>
```

Allowed types: `text`, `children`, `class`, `style`, `attribute`.

## Suspense (Experimental / Vue 3.3+)

```vue
<template>
  <Suspense>
    <AsyncDashboard />
    <template #fallback>
      <LoadingSkeleton />
    </template>
  </Suspense>
</template>
```

## Dynamic Components

```vue
<template>
  <component :is="stepComponent" v-bind="stepProps" @done="nextStep" />
</template>

<script setup lang="ts">
import Step1 from "./Step1.vue";
import Step2 from "./Step2.vue";
import Step3 from "./Step3.vue";

const stepComponent = computed(() => {
  const steps = [Step1, Step2, Step3];
  return steps[currentStep.value];
});
</script>
```

## Out of Scope (Pointer Sections)

### Nuxt-specific Patterns

Nuxt auto-imports, server routes, Nitro, modules, and build configuration are treated as a separate framework concern. When adding deep Nuxt-specific patterns, see `skills/nuxt4-patterns/` if present, or propose a dedicated `rules/nuxt/` track.

### Vue 2 / Migration

Options API, `Vue.extend`, `Vue.directive`, filters, and event bus patterns belong to migration documentation. New code should target Vue 3 Composition API.

## Skill Reference

For Vue deep dives see `skills/vue-patterns/SKILL.md`. For cross-framework frontend concerns see `skills/frontend-patterns/SKILL.md`. For accessibility see `skills/accessibility/SKILL.md`.

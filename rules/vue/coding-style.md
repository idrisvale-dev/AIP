---
paths:
  - "**/*.vue"
  - "**/components/**/*.ts"
  - "**/components/**/*.js"
  - "**/composables/**/*.ts"
  - "**/composables/**/*.js"
---
# Vue Coding Style

> This file extends [typescript/coding-style.md](../typescript/coding-style.md) and [common/coding-style.md](../common/coding-style.md) with Vue-specific conventions. For composable rules see [hooks.md](./hooks.md).

## API Style

- Use `<script setup>` Composition API for all new Vue 3 components.
- Options API is acceptable only when maintaining a legacy Vue 2 / early Vue 3 codebase.
- Mixins are forbidden in new code — replace with composables.
- `<script setup lang="ts">` for all TypeScript projects.

## File Extensions

- `.vue` for Single-File Components
- `.ts` for composables, stores, utilities, router config, type definitions
- `.test.ts` mirroring the source file
- `.cy.ts` for Cypress component tests

## Naming

| Entity | Convention | Example |
|--------|-----------|---------|
| Component files | PascalCase or kebab-case (team convention) | `UserCard.vue` or `user-card.vue` |
| Component name | `PascalCase` (multi-word, enforced by `vue/multi-word-component-names`) | `UserCard`, `BaseButton` |
| Composables | `useCamelCase` | `useUser`, `useDebounce` |
| Pinia stores | `useCamelCaseStore` | `useUserStore`, `useCartStore` |
| Props | camelCase in `<script>`, kebab-case in templates | `userName` / `user-name` |
| Events | kebab-case in templates | `@update:model-value`, `@item-selected` |
| Boolean props | `isXxx`, `hasXxx`, `canXxx`, `shouldXxx` | `isLoading`, `hasError`, `canSubmit` |

## Component Shape

```vue
<script setup lang="ts">
// 1. Imports
import { ref, computed, onMounted } from "vue";
import { useUser } from "@/composables/useUser";
import UserAvatar from "./UserAvatar.vue";

// 2. Props & Emits
const props = defineProps<{
  userId: string;
  showAvatar?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

// 3. Composables
const { user, isLoading } = useUser(() => props.userId);

// 4. Local state
const isExpanded = ref(false);

// 5. Computed
const displayName = computed(() =>
  user.value ? `${user.value.firstName} ${user.value.lastName}` : "Unknown"
);

// 6. Methods
function handleSelect() {
  emit("select", props.userId);
}

// 7. Lifecycle hooks
onMounted(() => {
  console.log("UserCard mounted");
});
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else>
    <UserAvatar :src="user?.avatar" />
    <span>{{ displayName }}</span>
    <button @click="handleSelect">Select</button>
  </div>
</template>
```

## Single-File Component Structure

Enforce this order inside `.vue` files:

1. `<script setup>` (or `<script>`)
2. `<template>`
3. `<style scoped>` (or `<style module>`)

Use block comments (`/* */`) inside `<script>`, HTML comments (`<!-- -->`) inside `<template>`.

## Props

- Prefer `defineProps<>()` type-based declaration with TypeScript.
- **Vue 3.5+**: Reactive Props Destructure is stabilized — you can destructure `defineProps()` and the variables are automatically reactive. Use JavaScript native default values syntax:
  ```ts
  const { count = 0, msg = "hello" } = defineProps<{ count?: number; msg?: string }>();
  ```
- **Vue < 3.5**: Use `withDefaults()` for typing props with default values, or access via `props.xxx`. Never destructure (captures snapshot).
- Never mutate props — use `defineEmits` for upward communication.
- Group related props into a single object type when they represent a logical entity.

```vue
<!-- Vue 3.5+: native defaults with destructuring -->
<script setup lang="ts">
const { user, variant = "primary", disabled = false } = defineProps<{
  user: User;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}>();
</script>

<!-- Vue < 3.5: withDefaults -->
<script setup lang="ts">
interface Props {
  user: User;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: "primary",
  disabled: false,
});
</script>
```

## Emits

- Use type-based `defineEmits<>()` with TypeScript payload signatures.
- Keep event names in kebab-case in templates, camelCase in script.

```vue
<script setup lang="ts">
const emit = defineEmits<{
  "update:modelValue": [value: string];
  submit: [];
  cancel: [];
}>();
</script>
```

## Slots

- Type slots explicitly with `defineSlots<>()` for TypeScript projects.
- Document slot purpose and expected props in a comment above template usage.

```vue
<script setup lang="ts">
defineSlots<{
  default: (props: { item: Item }) => any;
  header: () => any;
  footer: () => any;
}>();
</script>
```

## Template Conventions

- Self-close tags with no children: `<UserAvatar :src="url" />`
- Use `<template>` for conditional groups, not wrapper `<div>`.
- `v-if` / `v-else-if` / `v-else` must be on consecutive sibling elements.
- Never put multi-line logic inline in templates — extract to computed or method.

```vue
<!-- Prefer -->
<h1>{{ greeting }}</h1>

<!-- Over -->
<h1>{{ user.isAdmin ? "Welcome, admin" : `Hello ${user.name}` }}</h1>
```

## Imports

- Vue imports first: `import { ref, computed } from "vue"`
- Then ecosystem packages (vue-router, pinia), then absolute project imports, then relative
- Type-only imports: `import type { User } from "@/types"`
- Auto-imported functions (Nuxt, unplugin-auto-import) must still be explicitly imported when the project does not use auto-import.

## Script vs Template

- Keep `<script setup>` as the logic owner — templates should contain only rendering directives.
- Composable returns keep naming consistent: `const { user, isLoading } = useUser(id)` — destructured for readability.
- No side effects in `computed()` getters — they must be pure.

## Class Components

Forbidden in new code. The `vue-class-component` and `vue-property-decorator` libraries are deprecated. Migrate to Composition API.

## File Layout per Component

```
components/UserCard/
  UserCard.vue
  UserCard.test.ts
  index.ts             # re-export for barrel pattern
```

Or co-located:

```
components/UserCard.vue
components/__tests__/UserCard.test.ts
```

Follow the project's existing convention. Inline single-file components are fine for trivial presentational pieces.

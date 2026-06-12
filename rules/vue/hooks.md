---
paths:
  - "**/*.vue"
  - "**/composables/**/*.ts"
  - "**/composables/**/*.js"
  - "**/use-*.ts"
  - "**/use-*.js"
---
# Vue Composables and Reactivity

> This file covers **Vue composables** (`use*()`, `ref()`, `reactive()`, `computed()`, `watch()`, `watchEffect()`). Named to match the per-language convention `rules/<lang>/hooks.md`.
>
> Extends [typescript/patterns.md](../typescript/patterns.md) and [common/patterns.md](../common/patterns.md).

## Reactivity Fundamentals

### `ref()` vs `reactive()`

- Use `ref()` for primitives and for values that will be replaced wholesale.
- Use `reactive()` for object structures whose properties are mutated individually.
- In practice, `ref()` is preferred as the default — it's explicit, works everywhere, and avoids the pitfalls of `reactive()` (no replacement, no destructuring).

```ts
// ref — universal, explicit .value
const count = ref(0);
const user = ref<User | null>(null);

// reactive — only for objects, no .value
const form = reactive({ email: "", password: "" });
```

### Props Destructuring (Version-Specific)

**Vue 3.5+**: Reactive Props Destructure is stabilized and enabled by default. Destructured variables from `defineProps()` are automatically reactive — the compiler transforms `count` to `props.count` at compile time.

```vue
<script setup lang="ts">
// Vue 3.5+: CORRECT — destructured props are reactive
const { userId, userName } = defineProps<{ userId: string; userName: string }>();
// userId and userName track the parent's prop updates

// Native default values (Vue 3.5+)
const { count = 0, msg = "hello" } = defineProps<{
  count?: number;
  msg?: string;
}>();
```

**Vue < 3.5**: Destructuring captures snapshot values at setup time — they won't update.

```vue
<script setup lang="ts">
// Vue < 3.5: WRONG: destructured props lose reactivity
const { userId, userName } = defineProps<{ userId: string; userName: string }>();

// Vue < 3.5: CORRECT: access via props.xxx
const props = defineProps<{ userId: string; userName: string }>();
// In methods/computed: props.userId

// ALSO CORRECT: toRefs for individual refs
const { userId, userName } = toRefs(props);
</script>
```

**Important limitation (all Vue 3.5+ versions)**: You cannot `watch()` a destructured prop variable directly — must wrap in a getter:

```ts
// WRONG: direct watch on destructured prop (compile-time error in Vue 3.5+)
watch(count, (newVal) => { ... });

// CORRECT: getter wrapper
watch(() => count, (newVal) => { ... });
```

When passing a destructured prop to a composable that needs reactivity, wrap in a getter and use `toValue()` inside the composable:

```ts
useDynamicCount(() => count); // preserves reactivity
```

### Replacing reactive() Objects

```ts
// WRONG: breaks reactivity
let state = reactive({ a: 1, b: 2 });
state = reactive({ a: 3, b: 4 }); // new object, old watchers lost

// CORRECT: mutate in place
Object.assign(state, { a: 3, b: 4 });

// BETTER: use ref for values that get replaced
const state = ref({ a: 1, b: 2 });
state.value = { a: 3, b: 4 }; // reactivity preserved
```

### `.value` in Script vs Template

```vue
<script setup>
const count = ref(0);
// Inside script: MUST use .value
console.log(count.value);
function increment() { count.value++; }
</script>

<template>
  <!-- Inside template: NO .value (auto-unwrapped) -->
  <span>{{ count }}</span>
  <button @click="count++">Increment</button>
</template>
```

## `computed()` Rules

- Computed getters must be pure — no side effects (no state mutation, API calls, DOM writes).
- Never mutate other state inside a computed getter.
- Computed setter must be paired with a getter — don't create write-only computeds.

```ts
// CORRECT: pure getter
const fullName = computed(() => `${firstName.value} ${lastName.value}`);

// CORRECT: with setter
const fullName = computed({
  get: () => `${firstName.value} ${lastName.value}`,
  set: (val: string) => {
    const [first, last] = val.split(" ");
    firstName.value = first;
    lastName.value = last;
  },
});

// WRONG: side effect in computed
const displayName = computed(() => {
  analytics.track("name-computed"); // side effect
  return user.value.name;
});
```

## `watch()` vs `watchEffect()`

| Feature | `watch()` | `watchEffect()` |
|---------|-----------|-----------------|
| Explicit source | Yes — declare what to track | No — auto-tracks dependencies |
| Access to old/new values | Yes | No |
| Initial run | Optional (`immediate: true`) | Always runs immediately |
| Use case | Side effect on specific data change | Sync reactive state to external system |

```ts
// watch: explicit, has old/new
watch(
  () => props.userId,
  (newId, oldId) => {
    fetchUser(newId);
  }
);

// watchEffect: auto-tracking, immediate
watchEffect(() => {
  console.log(`User ${userId.value} is ${status.value}`);
});
```

## Watcher Source Pitfalls

```ts
// CORRECT: watching a ref tracks its value
const u = ref({ name: "Alice" });
watch(u, (val) => {});

// ALSO CORRECT: getter returning .value
watch(() => u.value, (val) => {});

// CORRECT: getter that accesses property on reactive object
watch(() => state.name, (val) => {}); // .name access inside getter is tracked
// The getter is re-evaluated because it accesses `.name` on the reactive proxy.

// WRONG: direct reactive property
watch(state.name, ...); // state.name evaluates to a primitive, not trackable

// CORRECT: getter returning reactive property
watch(() => state.name, (newName) => { ... });
```

## Cleanup

Every watcher that creates subscriptions, intervals, or fetch requests must clean up.

**Vue 3.5+**: Use `onWatcherCleanup()` (globally importable from `vue`) for watcher-side-effect cleanup. It must be called synchronously inside the watcher callback:

```ts
import { watch, onWatcherCleanup } from "vue";

watch(userId, async (newId) => {
  const controller = new AbortController();
  onWatcherCleanup(() => controller.abort());
  const data = await fetch(`/api/users/${newId}`, { signal: controller.signal });
  user.value = await data.json();
});
```

**All Vue 3 versions**: The watcher callback also receives an `onCleanup` parameter:

```ts
// watch callback receives an onCleanup function
watch(userId, async (newId, _oldId, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const data = await fetch(`/api/users/${newId}`, { signal: controller.signal });
  user.value = await data.json();
});

// watchEffect also receives onCleanup
watchEffect((onCleanup) => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));
});
```

## `useTemplateRef()` (Vue 3.5+)

Use `useTemplateRef()` instead of matching a plain `ref` variable name to the template `ref` attribute. It supports dynamic ref IDs and provides better type safety.

```vue
<script setup lang="ts">
import { useTemplateRef } from "vue";

// Static ref
const inputEl = useTemplateRef<HTMLInputElement>("input");

// Dynamic ref
const refId = ref("input");
const dynamicEl = useTemplateRef<HTMLInputElement>(refId);
</script>

<template>
  <input ref="input" type="text" />
</template>
```

- The string passed to `useTemplateRef()` must match the `ref` attribute value in the template, **not** the variable name.
- `@vue/language-tools` 2.1+ provides auto-completion and warnings for `useTemplateRef`.

## Composable Conventions

### Must start with `use`

```ts
// CORRECT
export function useDebounce<T>(value: Ref<T>, delay: number): Ref<T> { ... }

// WRONG
export function debounce<T>(value: Ref<T>, delay: number): Ref<T> { ... }
```

### Return reactive values

Composables must return `ref()` / `computed()` / `reactive()` so the consumer stays reactive. Never return a raw primitive or plain object snapshot.

```ts
// CORRECT
export function useCounter() {
  const count = ref(0);
  const doubled = computed(() => count.value * 2);
  function increment() { count.value++; }
  return { count, doubled, increment };
}

// WRONG: returns snapshot
export function useCounter() {
  let count = 0;
  function increment() { count++; }
  return { count, increment }; // count is a plain number — not reactive
}
```

### Accept reactive inputs gracefully

When a composable accepts reactive data, use `toRef()` / `toValue()` (Vue 3.3+) so callers can pass either a ref or a plain value.

```ts
export function useTitle(newTitle: MaybeRef<string>) {
  const title = toRef(newTitle);
  watchEffect(() => {
    document.title = title.value;
  });
}

// Caller can pass either:
useTitle("Home");         // plain value
useTitle(ref("Home"));    // ref
useTitle(computed(...));  // computed
```

### Side effects must be scoped

Composables that create side effects (event listeners, timers, subscriptions) must:

1. Only run when the component using them is mounted — use `onMounted` / `watch`.
2. Clean up automatically — use `onUnmounted` or watcher `onCleanup`.

```ts
export function useEventListener<K extends keyof WindowEventMap>(
  event: K,
  handler: (e: WindowEventMap[K]) => void,
) {
  onMounted(() => window.addEventListener(event, handler));
  onUnmounted(() => window.removeEventListener(event, handler));
}
```

### No module-scope side effects

Never initialize state, start timers, or subscribe to external systems in the module scope of a composable file — it runs once regardless of component instance count.

```ts
// WRONG: module scope side effect
const globalCount = ref(0); // FAIL shared across all components
setInterval(() => globalCount.value++, 1000);

export function useGlobalCount() {
  return globalCount;
}

// CORRECT: scoped to each invocation
export function useInterval(fn: () => void, ms: number) {
  onMounted(() => {
    const id = setInterval(fn, ms);
    onUnmounted(() => clearInterval(id));
  });
}
```

## `shallowRef()` and `shallowReactive()`

Use `shallowRef()` for large immutable data structures that are replaced as a whole — avoids the deep reactivity overhead.

```ts
const items = shallowRef<Item[]>([]);
// items.value = await fetchItems(); // replacement works
// items.value[0].name = "new";     // FAIL inner mutations are NOT reactive
```

Use `shallowReactive()` when only top-level properties should be reactive.

## Lint Configuration

Required rules:

```json
{
  "rules": {
    "vue/no-ref-as-operand": "error",
    "vue/no-mutating-props": "error",
    "vue/return-in-computed-property": "error"
  }
}
```

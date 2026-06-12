---
paths:
  - "**/*.vue"
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/composables/**/*.ts"
  - "**/stores/**/*.ts"
---
# Vue Testing

> This file extends [typescript/testing.md](../typescript/testing.md), [common/testing.md](../common/testing.md), and [react/testing.md](../react/testing.md) with Vue-specific testing guidance.

## Testing Stack

- **Vitest** as the test runner (fast, Vite-native, Jest-compatible API).
- **Vue Test Utils** (`@vue/test-utils`) for component mounting and interaction.
- **@pinia/testing** for mocking Pinia stores in tests.
- **@testing-library/vue** when preferring user-centric queries over component internals.
- **Playwright / Cypress** for end-to-end tests.

```bash
npm install -D vitest @vue/test-utils jsdom
```

## Test File Location

```
src/components/UserCard/
  UserCard.vue
  UserCard.test.ts         # co-located
  index.ts
```

Or:

```
src/components/UserCard.vue
src/components/__tests__/UserCard.test.ts
```

Follow the project's existing convention consistently.

## Component Testing

### Mounting

```ts
import { mount, shallowMount } from "@vue/test-utils";
import UserCard from "./UserCard.vue";
import { createPinia, setActivePinia } from "pinia";

describe("UserCard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders user name", () => {
    const wrapper = mount(UserCard, {
      props: {
        user: { id: "1", name: "Alice" },
      },
    });
    expect(wrapper.text()).toContain("Alice");
  });

  it("emits select event on click", async () => {
    const wrapper = mount(UserCard, {
      props: {
        user: { id: "1", name: "Alice" },
      },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["1"]);
  });
});
```

### shallowMount vs mount

- `shallowMount`: Stubs all child components — faster, tests the component in isolation. Useful for unit tests.
- `mount`: Renders the full tree — tests integration. Use for critical user-facing component tests.

```ts
// Unit test — use shallowMount
const wrapper = shallowMount(UserCard, { props: { user } });
// Only UserCard renders; child components are stubs

// Integration test — use mount
const wrapper = mount(Form, {
  global: {
    plugins: [createPinia()],
  },
});
// Full rendering tree
```

### Stubs and Mocks

```ts
// Stub a child component
const wrapper = mount(Parent, {
  global: {
    stubs: {
      HeavyChart: true, // renders as empty placeholder
      UserAvatar: {
        template: '<div class="mock-avatar" />',
      },
    },
  },
});

// Mock a composable
vi.mock("@/composables/useUser", () => ({
  useUser: () => ({
    user: ref({ id: "1", name: "Test" }),
    isLoading: ref(false),
  }),
}));

// Mock a Pinia store
const store = useUserStore();
store.$patch({ currentUser: { id: "1", name: "Test" } });
```

## Composable Testing

```ts
import { useCounter } from "./useCounter";
import { createApp, ref } from "vue";

// With effectScope for cleanup
import { effectScope } from "vue";

describe("useCounter", () => {
  it("increments count", () => {
    const scope = effectScope();
    const { count, increment } = scope.run(() => useCounter())!;

    expect(count.value).toBe(0);
    increment();
    expect(count.value).toBe(1);

    scope.stop(); // cleanup watchers
  });
});
```

For composables with lifecycle hooks, mount inside a component:

```ts
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

function mountComposable<T>(composable: () => T) {
  let result: T;
  const TestComponent = defineComponent({
    setup() { result = composable(); },
    render: () => h("div"),
  });
  mount(TestComponent);
  return result!;
}

it("useEventListener attaches listener", () => {
  const handler = vi.fn();
  mountComposable(() => useEventListener("click", handler));
  window.dispatchEvent(new Event("click"));
  expect(handler).toHaveBeenCalled();
});
```

## Pinia Store Testing

```ts
import { setActivePinia, createPinia } from "pinia";
import { useUserStore } from "./useUserStore";

describe("useUserStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("fetches user and updates state", async () => {
    vi.mocked(getUser).mockResolvedValue({ id: "1", name: "Alice" });

    const store = useUserStore();
    await store.fetchUser("1");

    expect(store.currentUser).toEqual({ id: "1", name: "Alice" });
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("handles fetch error", async () => {
    vi.mocked(getUser).mockRejectedValue(new Error("Not found"));

    const store = useUserStore();
    await store.fetchUser("999");

    expect(store.currentUser).toBeNull();
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeInstanceOf(Error);
  });
});
```

## Vue Router Testing

```ts
import { createRouter, createWebHistory } from "vue-router";
import { mount } from "@vue/test-utils";
import UserPage from "./UserPage.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/users/:id", component: UserPage, props: true },
  ],
});

// Navigate before mounting
await router.push("/users/42");
await router.isReady();

const wrapper = mount(UserPage, {
  global: { plugins: [router] },
});
```

- Use `createMemoryHistory()` for tests to avoid URL state leaks.
- Always `await router.isReady()` before asserting.

## What to Test

| Level | What | Example |
|-------|------|---------|
| Unit | Composables, utility functions, store actions | `useCounter().increment()` works |
| Component | Rendering, props, events, slots | `UserCard` renders name, emits on click |
| Integration | Multiple components, router, store together | Form submits, store updates, route navigates |
| E2E | Critical user flows | Login → dashboard → create item |

## Coverage Thresholds

- Unit tests: 80%+ for composables and store logic.
- Component tests: every component with logic beyond pure presentation should have at least a smoke test.
- E2E: at minimum, login, signup, and the primary user journey.

## Common Pitfalls

### Async Assertions

```ts
// WRONG: assertion not awaited
it("loads user", () => {
  const wrapper = mount(UserCard, { props: { userId: "1" } });
  expect(wrapper.text()).toContain("Alice"); // fetch hasn't resolved yet
});

// CORRECT: wait for DOM updates
it("loads user", async () => {
  const wrapper = mount(UserCard, { props: { userId: "1" } });
  await flushPromises(); // or nextTick / waitFor
  expect(wrapper.text()).toContain("Alice");
});
```

### Not Cleaning Up

Vitest auto-cleans with `vi.restoreAllMocks()`, but manual timers and subscriptions need explicit cleanup:

```ts
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
```

### Testing Implementation Details

```ts
// WRONG: testing internal ref name
expect(wrapper.vm._internalCounter).toBe(5);

// CORRECT: testing rendered output or public API
expect(wrapper.find(".count-display").text()).toBe("5");
```

## Vitest Configuration

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{vue,ts}"],
    },
  },
});
```

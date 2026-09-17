/** Fixtures and auth-free previews are allowed only in explicit non-production modes. */
export const demoMode = process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_MODE === "true" && ["local", "preview", "test"].includes(process.env.NEXT_PUBLIC_APP_ENV ?? "");
// Browser acceptance tests use a stateful intercepted API rather than the fixture adapter.
export const fixtureMode = demoMode && !(process.env.NEXT_PUBLIC_APP_ENV === "test" && process.env.NEXT_PUBLIC_TEST_API === "true");

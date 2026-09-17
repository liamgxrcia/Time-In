import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProductionConfig } from "@/lib/server/supabase";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "https://crm.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-value");
  vi.stubEnv("RATE_LIMIT_SECRET", "x".repeat(32));
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("DEMO_MODE", "false");
});
afterEach(() => vi.unstubAllEnvs());
describe("production configuration fails closed", () => {
  it("accepts isolated HTTPS deployment configuration", () =>
    expect(() => assertProductionConfig()).not.toThrow());
  it.each([
    ["APP_ENV", "local"],
    ["APP_ORIGIN", "http://crm.example"],
    ["APP_ORIGIN", "https://crm.example/path"],
    ["APP_ORIGIN", "https://localhost"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://example.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_never_public"],
    ["NEXT_PUBLIC_DEMO_MODE", "true"],
    ["SUPABASE_SERVICE_ROLE_KEY", ""],
    ["RATE_LIMIT_SECRET", "short"],
    ["VERCEL_ENV", "preview"],
  ])("rejects unsafe %s", (key, value) => {
    vi.stubEnv(key, value);
    expect(() => assertProductionConfig()).toThrow();
  });
  it("rejects a legacy service-role JWT in public configuration", () => {
    const token = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", token);
    expect(() => assertProductionConfig()).toThrow();
  });
});

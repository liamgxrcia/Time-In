import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAdminEmail } from "@/lib/server/admin-identity";

beforeEach(() => {
  vi.stubEnv("BONUSHUB_ADMIN_USERNAME", "private-command-centre");
  vi.stubEnv("BONUSHUB_ADMIN_EMAIL", "ceo@example.test");
});

afterEach(() => vi.unstubAllEnvs());

describe("public admin login identity", () => {
  it("maps the configured public username to the private Auth email", () => {
    expect(resolveAdminEmail("  private-command-centre ")).toBe("ceo@example.test");
  });

  it("keeps ordinary email sign-in compatible while rejecting unknown identifiers", () => {
    expect(resolveAdminEmail("ceo@example.test")).toBe("ceo@example.test");
    expect(resolveAdminEmail("unknown-user")).toBeNull();
  });

  it("fails closed when the username mapping is incomplete", () => {
    vi.stubEnv("BONUSHUB_ADMIN_EMAIL", "");
    expect(resolveAdminEmail("private-command-centre")).toBeNull();
  });
});

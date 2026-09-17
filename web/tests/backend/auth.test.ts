import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createServerClient: vi.fn(),
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
  assurance: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: mocks.cookieGetAll, set: mocks.cookieSet }),
}));
import { requireCEO, assertOrigin, userClient } from "@/lib/server/supabase";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-example");
  vi.stubEnv("APP_ORIGIN", "https://crm.example");
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
  mocks.createServerClient.mockReturnValue({
    auth: {
      getUser: mocks.getUser,
      mfa: { getAuthenticatorAssuranceLevel: mocks.assurance },
    },
    rpc: mocks.rpc,
  });
});
describe("server auth/session checks", () => {
  it("rejects expired sessions reported by Auth, without trusting a cookie payload", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "JWT expired" },
    });
    await expect(requireCEO()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires CEO membership after validating Auth identity", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireCEO()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("returns only an authenticated authorized user client", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect((await requireCEO()).user.id).toBe("u");
  });
  it("requires MFA when a verified factor is configured", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    });
    mocks.assurance.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    await expect(requireCEO()).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sets HTTP-only same-site cookies and enforces request origins", async () => {
    await userClient();
    expect(
      mocks.createServerClient.mock.calls[0][2].cookieOptions,
    ).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(() =>
      assertOrigin(
        new Request("https://crm.example", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertOrigin(
        new Request("https://crm.example", {
          headers: { origin: "https://crm.example" },
        }),
      ),
    ).not.toThrow();
  });
});

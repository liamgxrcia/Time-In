import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/server/errors";
const mocks = vi.hoisted(() => ({
  requireCEO: vi.fn(),
  assertOrigin: vi.fn(),
  snapshot: vi.fn(),
  execute: vi.fn(),
  limit: vi.fn(),
  selectOnboarding: vi.fn(),
}));
vi.mock("@/lib/server/supabase", () => ({
  requireCEO: mocks.requireCEO,
  assertOrigin: mocks.assertOrigin,
}));
vi.mock("@/lib/server/repository", () => ({
  snapshot: mocks.snapshot,
  execute: mocks.execute,
  limit: mocks.limit,
  selectOnboarding: mocks.selectOnboarding,
}));
import { GET, POST } from "@/app/api/crm/[operation]/route";
const context = (operation: string) => ({
  params: Promise.resolve({ operation }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCEO.mockResolvedValue({ client: {}, user: { id: "ceo" } });
  mocks.limit.mockResolvedValue(undefined);
});
describe("API authorization and safe response boundary", () => {
  it("returns 401 when session is missing or expired before reading data", async () => {
    mocks.requireCEO.mockRejectedValue(new ApiError("UNAUTHENTICATED"));
    const response = await GET(
      new Request("https://crm.example/api/crm/snapshot"),
      context("snapshot"),
    );
    expect(response.status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });
  it("returns 403 for an authenticated non-CEO", async () => {
    mocks.requireCEO.mockRejectedValue(new ApiError("FORBIDDEN"));
    expect(
      (
        await GET(
          new Request("https://crm.example/api/crm/snapshot"),
          context("snapshot"),
        )
      ).status,
    ).toBe(403);
  });
  it("rejects cross-origin mutation before authentication or database work", async () => {
    mocks.assertOrigin.mockImplementation(() => {
      throw new ApiError("FORBIDDEN");
    });
    const response = await POST(
      new Request("https://crm.example/api/crm/command", { method: "POST" }),
      context("command"),
    );
    expect(response.status).toBe(403);
    expect(mocks.requireCEO).not.toHaveBeenCalled();
  });
  it("rate limits before reading confidential data", async () => {
    mocks.limit.mockRejectedValue(new ApiError("RATE_LIMITED"));
    const response = await GET(
      new Request("https://crm.example/api/crm/snapshot"),
      context("snapshot"),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("validates mutation payload before execution", async () => {
    const response = await POST(
      new Request("https://crm.example/api/crm/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: { type: "lifecycle.transition" } }),
      }),
      context("command"),
    );
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("returns stable typed success envelopes and disables caching", async () => {
    mocks.snapshot.mockResolvedValue({ people: [] });
    const response = await GET(
      new Request("https://crm.example/api/crm/snapshot"),
      context("snapshot"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      data: { people: [] },
      error: null,
    });
  });
  it("redacts raw service failures", async () => {
    mocks.snapshot.mockRejectedValue(new Error("password=secret SQL error"));
    const response = await GET(
      new Request("https://crm.example/api/crm/snapshot"),
      context("snapshot"),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("password");
  });
});

it("preserves source and consent fields at the HTTP command boundary", async () => {
  const command = {
    type: "person.create",
    name: "Example",
    source: "referral",
    sourceNote: "Introduction",
    consentNote: "May call",
    communicationRestricted: false,
  };
  const operationId = "11111111-1111-4111-8111-111111111111";
  mocks.execute.mockResolvedValue({ id: operationId, revision: 0 });
  const response = await POST(
    new Request("https://crm.example/api/crm/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId, command }),
    }),
    context("command"),
  );
  expect(response.status).toBe(200);
  expect(mocks.execute).toHaveBeenCalledWith({}, { operationId, command });
});
it("import preview is read-only at the API boundary", async () => {
  mocks.snapshot.mockResolvedValue({ people: [] });
  const response = await POST(
    new Request("https://crm.example/api/crm/import-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        csv: "Name,Email\nExample,person@example.test",
        mapping: { name: "Name", email: "Email" },
      }),
    }),
    context("import-preview"),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).data.validCount).toBe(1);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("returns persisted notification preference revision and delivery capability", async () => {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({
      data: { email_enabled: true, web_push_enabled: false, revision: 4 },
      error: null,
    });
  mocks.requireCEO.mockResolvedValue({
    client: { from: () => ({ select: () => ({ maybeSingle }) }) },
  });
  const response = await GET(
    new Request("https://crm.example/api/crm/notification-preferences"),
    context("notification-preferences"),
  );
  expect((await response.json()).data).toEqual({
    emailEnabled: true,
    webPushEnabled: false,
    revision: 4,
    deliveryAvailable: false,
  });
});

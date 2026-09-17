import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  requireCEO: vi.fn(),
  adminClient: vi.fn(),
  assertOrigin: vi.fn(),
  execute: vi.fn(),
  limit: vi.fn(),
  single: vi.fn(),
  signed: vi.fn(),
}));
vi.mock("@/lib/server/supabase", () => ({
  requireCEO: mocks.requireCEO,
  adminClient: mocks.adminClient,
  assertOrigin: mocks.assertOrigin,
}));
vi.mock("@/lib/server/repository", () => ({
  execute: mocks.execute,
  limit: mocks.limit,
}));
import { POST } from "@/app/api/crm/files/[operation]/route";
const id = "11111111-1111-4111-8111-111111111111";
const request = () =>
  new Request("https://crm.example/api/crm/files/access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: mocks.single,
  };
  mocks.requireCEO.mockResolvedValue({
    client: { from: () => query },
    user: { id: "ceo" },
  });
  mocks.adminClient.mockReturnValue({
    storage: { from: () => ({ createSignedUrl: mocks.signed }) },
  });
  mocks.limit.mockResolvedValue(undefined);
});
describe("private signed file access", () => {
  it("never creates privileged storage client for inaccessible metadata", async () => {
    mocks.single.mockResolvedValue({ data: null, error: {} });
    const response = await POST(request(), {
      params: Promise.resolve({ operation: "access" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });
  it("audits available file access and signs an expiring attachment URL", async () => {
    mocks.single.mockResolvedValue({
      data: {
        id,
        owner_id: "ceo",
        status: "available",
        storage_path: "ceo/private-id",
        display_name: "Agreement.pdf",
      },
      error: null,
    });
    mocks.signed.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed" },
      error: null,
    });
    const response = await POST(request(), {
      params: Promise.resolve({ operation: "access" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.signed).toHaveBeenCalledWith("ceo/private-id", 60, {
      download: "Agreement.pdf",
    });
    expect(mocks.execute).toHaveBeenCalled();
    expect((await response.json()).data.expiresIn).toBe(60);
  });
});

describe("signed upload authorization", () => {
  it("audits upload capability and disables overwrite", async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({
        data: {
          signedUrl: "https://storage.example/upload",
          path: "ceo/file",
          token: "upload-only-token",
        },
        error: null,
      });
    mocks.single.mockResolvedValue({
      data: { id, status: "pending", storage_path: "ceo/file" },
      error: null,
    });
    mocks.adminClient.mockReturnValue({
      storage: { from: () => ({ createSignedUploadUrl: upload }) },
    });
    const response = await POST(request(), {
      params: Promise.resolve({ operation: "upload" }),
    });
    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledWith("ceo/file", { upsert: false });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        command: { type: "security.event", event: "file_upload", targetId: id },
      }),
    );
  });
  it.each([
    ["upload", "available"],
    ["access", "pending"],
    ["unknown", "available"],
  ])(
    "denies %s for %s before privileged client creation",
    async (operation, status) => {
      mocks.single.mockResolvedValue({ data: { id, status }, error: null });
      const response = await POST(request(), {
        params: Promise.resolve({ operation }),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mocks.adminClient).not.toHaveBeenCalled();
    },
  );
  it("does not issue a URL if audit fails", async () => {
    mocks.single.mockResolvedValue({
      data: { id, status: "available" },
      error: null,
    });
    mocks.execute.mockRejectedValue(new Error("Audit unavailable"));
    const response = await POST(request(), {
      params: Promise.resolve({ operation: "access" }),
    });
    expect(response.status).toBe(500);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });
});

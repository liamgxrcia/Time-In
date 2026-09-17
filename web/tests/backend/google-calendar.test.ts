import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthorisationUrl,
  createGooglePKCE,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  googleCalendarEvents,
  googleOAuthConfig,
} from "@/lib/server/google-calendar";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.stubEnv("GOOGLE_REDIRECT_URI", "https://bonushub.example/api/integrations/google/callback");
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "11".repeat(32));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google Calendar connection helpers", () => {
  it("creates a PKCE challenge that matches the verifier", () => {
    const { verifier, challenge, state } = createGooglePKCE();
    expect(verifier).toHaveLength(43);
    expect(state).toHaveLength(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("builds a read-only Google authorisation URL", () => {
    const config = googleOAuthConfig();
    const url = new URL(buildGoogleAuthorisationUrl(config, "state", "challenge"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
  });

  it("encrypts integration credentials without storing plaintext", () => {
    const ciphertext = encryptIntegrationSecret("refresh-token-value");
    expect(ciphertext).not.toContain("refresh-token-value");
    expect(decryptIntegrationSecret(ciphertext)).toBe("refresh-token-value");
  });

  it("normalises upcoming events and drops malformed provider records", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [
        {
          id: "event-1",
          summary: "Quarterly review",
          start: { dateTime: "2026-09-20T14:00:00Z" },
          end: { dateTime: "2026-09-20T15:00:00Z" },
          htmlLink: "https://calendar.google.com/calendar/event?eid=1",
        },
        { id: "malformed", start: {}, end: {} },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(googleCalendarEvents("access-token")).resolves.toEqual([{
      id: "event-1",
      summary: "Quarterly review",
      start: "2026-09-20T14:00:00Z",
      end: "2026-09-20T15:00:00Z",
      htmlLink: "https://calendar.google.com/calendar/event?eid=1",
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("calendarId=primary"),
      expect.objectContaining({ headers: { authorization: "Bearer access-token" } }),
    );
  });

  it("rejects missing OAuth or encryption configuration", () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(() => googleOAuthConfig()).toThrow();
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "short");
    expect(() => encryptIntegrationSecret("value")).toThrow();
  });
});

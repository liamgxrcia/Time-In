import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { ApiError } from "./errors";

export const GOOGLE_CALENDAR_PROVIDER = "google_calendar";
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string | null;
};

export function googleOAuthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${process.env.APP_ORIGIN?.replace(/\/$/, "")}/api/integrations/google/callback`;
  if (!clientId || !clientSecret || !redirectUri) throw new ApiError("UNAVAILABLE");
  try {
    const parsed = new URL(redirectUri);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new ApiError("UNAVAILABLE");
  }
  return { clientId, clientSecret, redirectUri };
}

function base64url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

export function createGooglePKCE() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));
  return { verifier, challenge, state };
}

export function buildGoogleAuthorisationUrl(
  config: OAuthConfig,
  state: string,
  challenge: string,
) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function parseGoogleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError("UNAVAILABLE");
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload) throw new ApiError("UNAVAILABLE");
  return payload;
}

const googleRequestSignal = () => AbortSignal.timeout(10_000);

export async function exchangeGoogleCode(
  config: OAuthConfig,
  code: string,
  verifier: string,
) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
    signal: googleRequestSignal(),
  });
  const token = await parseGoogleResponse<GoogleTokenResponse>(response);
  if (!token.access_token || !token.expires_in) throw new ApiError("UNAVAILABLE");
  return token;
}

export async function refreshGoogleToken(config: OAuthConfig, refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: googleRequestSignal(),
  });
  const token = await parseGoogleResponse<GoogleTokenResponse>(response);
  if (!token.access_token || !token.expires_in) throw new ApiError("UNAVAILABLE");
  return token;
}

export async function googleAccountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: googleRequestSignal(),
  });
  const profile = await parseGoogleResponse<{ email?: string; email_verified?: boolean }>(response);
  if (!profile.email || profile.email_verified === false) throw new ApiError("UNAVAILABLE");
  return profile.email.toLowerCase();
}

function eventDate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as { dateTime?: unknown; date?: unknown };
  if (typeof item.dateTime === "string") return item.dateTime;
  if (typeof item.date === "string") return `${item.date}T00:00:00.000Z`;
  return null;
}

export async function googleCalendarEvents(accessToken: string): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: "25",
    singleEvents: "true",
    orderBy: "startTime",
  });
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: googleRequestSignal(),
  });
  const payload = await parseGoogleResponse<{ items?: Array<Record<string, unknown>> }>(response);
  return (payload.items ?? []).flatMap((event) => {
    const start = eventDate(event.start);
    const end = eventDate(event.end);
    if (typeof event.id !== "string" || !start || !end) return [];
    const htmlLink = typeof event.htmlLink === "string" && event.htmlLink.startsWith("https://calendar.google.com/") ? event.htmlLink : null;
    return [{ id: event.id, summary: typeof event.summary === "string" && event.summary.trim() ? event.summary.trim() : "Untitled event", start, end, htmlLink }];
  });
}

function integrationKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim() ?? "";
  try {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error();
    return key;
  } catch {
    throw new ApiError("UNAVAILABLE");
  }
}

export function encryptIntegrationSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", integrationKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${base64url(iv)}.${base64url(cipher.getAuthTag())}.${base64url(ciphertext)}`;
}

export function decryptIntegrationSecret(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new ApiError("UNAVAILABLE");
  try {
    const decipher = createDecipheriv("aes-256-gcm", integrationKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ApiError("UNAVAILABLE");
  }
}

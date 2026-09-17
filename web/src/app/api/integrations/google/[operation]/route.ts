import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/contracts/database.types";
import {
  adminClient,
  assertOrigin,
  requireCEO,
} from "@/lib/server/supabase";
import { ApiError, errorResponse, logEvent } from "@/lib/server/errors";
import {
  GOOGLE_CALENDAR_PROVIDER,
  buildGoogleAuthorisationUrl,
  createGooglePKCE,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  exchangeGoogleCode,
  googleAccountEmail,
  googleCalendarEvents,
  googleOAuthConfig,
  refreshGoogleToken,
} from "@/lib/server/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stateCookie = "bonushub_google_oauth";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
type Connection = Database["public"]["Tables"]["integration_connections"]["Row"];
type Context = { params: Promise<{ operation: string }> };

function safeEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function encodeState(value: { state: string; verifier: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeState(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { state?: unknown; verifier?: unknown };
    return typeof parsed.state === "string" && typeof parsed.verifier === "string"
      ? { state: parsed.state, verifier: parsed.verifier }
      : null;
  } catch {
    return null;
  }
}

function settingsURL(request: Request, result: "connected" | "error" | "disconnected") {
  const origin = process.env.APP_ORIGIN?.trim();
  const url = origin ? new URL("/settings", origin) : new URL("/settings", request.url);
  url.searchParams.set("google", result);
  return url;
}

async function connectionFor(ownerId: string) {
  const { data, error } = await adminClient()
    .from("integration_connections")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("provider", GOOGLE_CALENDAR_PROVIDER)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new ApiError("UNAVAILABLE");
  return data as Connection | null;
}

async function audit(ownerId: string, action: string) {
  const { error } = await adminClient().from("audit_events").insert({
    owner_id: ownerId,
    action,
    operation_id: randomUUID(),
    target_id: null,
    metadata: { provider: GOOGLE_CALENDAR_PROVIDER },
  });
  if (error) throw new ApiError("UNAVAILABLE");
}

async function saveConnection(
  ownerId: string,
  token: { access_token: string; refresh_token?: string; expires_in: number; scope?: string },
  accountEmail: string,
  existing: Connection | null,
) {
  const record = {
    owner_id: ownerId,
    provider: GOOGLE_CALENDAR_PROVIDER,
    provider_account_email: accountEmail,
    scopes: (token.scope?.split(" ").filter(Boolean) ?? []).slice(0, 20),
    access_token_ciphertext: encryptIntegrationSecret(token.access_token),
    refresh_token_ciphertext: token.refresh_token
      ? encryptIntegrationSecret(token.refresh_token)
      : existing?.refresh_token_ciphertext ?? null,
    token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    health: "healthy",
    error_category: null,
    archived_at: null,
    last_sync: existing?.last_sync ?? null,
    updated_at: new Date().toISOString(),
  };
  const query = existing
    ? adminClient().from("integration_connections").update(record).eq("id", existing.id).eq("owner_id", ownerId)
    : adminClient().from("integration_connections").insert(record);
  const { error } = await query;
  if (error) throw new ApiError("UNAVAILABLE");
}

async function markConnection(ownerId: string, values: Partial<Connection>) {
  const connection = await connectionFor(ownerId);
  if (!connection) return;
  const { error } = await adminClient().from("integration_connections").update(values).eq("id", connection.id).eq("owner_id", ownerId);
  if (error) throw new ApiError("UNAVAILABLE");
}

async function begin() {
  await requireCEO();
  const config = googleOAuthConfig();
  const pkce = createGooglePKCE();
  const response = NextResponse.redirect(buildGoogleAuthorisationUrl(config, pkce.state, pkce.challenge));
  response.cookies.set({
    name: stateCookie,
    value: encodeState({ state: pkce.state, verifier: pkce.verifier }),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return response;
}

async function callback(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("error")) {
    const response = NextResponse.redirect(settingsURL(request, "error"));
    response.cookies.delete(stateCookie);
    return response;
  }
  const stored = decodeState((await cookies()).get(stateCookie)?.value);
  if (!stored || !safeEqual(stored.state, params.get("state") ?? "")) throw new ApiError("FORBIDDEN");
  const code = params.get("code");
  if (!code) throw new ApiError("VALIDATION");
  const { user } = await requireCEO();
  const config = googleOAuthConfig();
  const token = await exchangeGoogleCode(config, code, stored.verifier);
  const accountEmail = await googleAccountEmail(token.access_token!);
  const existing = await connectionFor(user.id);
  await saveConnection(user.id, token as { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, accountEmail, existing);
  await audit(user.id, "integration.google_calendar.connected");
  const response = NextResponse.redirect(settingsURL(request, "connected"));
  response.cookies.delete(stateCookie);
  return response;
}

async function status(ownerId: string) {
  const connection = await connectionFor(ownerId);
  if (!connection) return { connected: false, provider: GOOGLE_CALENDAR_PROVIDER, health: "disconnected" as const, accountEmail: null, scopes: [], lastSync: null };
  return {
    connected: connection.health === "healthy" || Boolean(connection.refresh_token_ciphertext),
    provider: connection.provider,
    health: connection.health as "disconnected" | "healthy" | "warning",
    accountEmail: connection.provider_account_email,
    scopes: connection.scopes,
    lastSync: connection.last_sync,
  };
}

async function events(ownerId: string) {
  const connection = await connectionFor(ownerId);
  if (!connection?.access_token_ciphertext) return { connected: false, events: [] };
  const config = googleOAuthConfig();
  let accessToken = decryptIntegrationSecret(connection.access_token_ciphertext);
  if (!connection.token_expires_at || new Date(connection.token_expires_at).getTime() <= Date.now() + 60_000) {
    if (!connection.refresh_token_ciphertext) throw new ApiError("UNAVAILABLE");
    const refreshed = await refreshGoogleToken(config, decryptIntegrationSecret(connection.refresh_token_ciphertext));
    accessToken = refreshed.access_token!;
    const { error } = await adminClient().from("integration_connections").update({
      access_token_ciphertext: encryptIntegrationSecret(accessToken),
      token_expires_at: new Date(Date.now() + refreshed.expires_in! * 1000).toISOString(),
      health: "healthy",
      error_category: null,
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id).eq("owner_id", ownerId);
    if (error) throw new ApiError("UNAVAILABLE");
  }
  try {
    const upcoming = await googleCalendarEvents(accessToken);
    await adminClient().from("integration_connections").update({
      health: "healthy",
      last_sync: new Date().toISOString(),
      error_category: null,
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id).eq("owner_id", ownerId);
    return { connected: true, events: upcoming };
  } catch {
    await markConnection(ownerId, { health: "warning", error_category: "calendar_sync" });
    throw new ApiError("UNAVAILABLE");
  }
}

export async function GET(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const { operation } = await context.params;
    if (operation === "start") return await begin();
    if (operation === "callback") return await callback(request);
    const { user } = await requireCEO();
    if (operation === "status") return NextResponse.json({ data: await status(user.id), error: null, requestId }, { headers });
    if (operation === "events") return NextResponse.json({ data: await events(user.id), error: null, requestId }, { headers });
    throw new ApiError("NOT_FOUND");
  } catch (error) {
    const failure = errorResponse(error, requestId);
    logEvent("google_calendar.failure", requestId, failure.body.error?.code);
    return NextResponse.json(failure.body, { status: failure.status, headers });
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    assertOrigin(request);
    const { operation } = await context.params;
    if (operation !== "disconnect") throw new ApiError("NOT_FOUND");
    const { user } = await requireCEO();
    const connection = await connectionFor(user.id);
    if (connection) {
      const { error } = await adminClient().from("integration_connections").update({
        archived_at: new Date().toISOString(),
        health: "disconnected",
        access_token_ciphertext: null,
        refresh_token_ciphertext: null,
        token_expires_at: null,
        error_category: null,
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id).eq("owner_id", user.id);
      if (error) throw new ApiError("UNAVAILABLE");
      await audit(user.id, "integration.google_calendar.disconnected");
    }
    return NextResponse.json({ data: { disconnected: true }, error: null, requestId }, { headers });
  } catch (error) {
    const failure = errorResponse(error, requestId);
    logEvent("google_calendar.failure", requestId, failure.body.error?.code);
    return NextResponse.json(failure.body, { status: failure.status, headers });
  }
}

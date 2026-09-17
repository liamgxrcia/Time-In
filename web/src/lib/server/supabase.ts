import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/contracts/database.types";
import { ApiError } from "./errors";
/** Fail closed on deployed configuration; values never appear in errors/logs. */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV) return;
  try {
    const origin = new URL(process.env.APP_ORIGIN ?? "");
    const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const environment = process.env.APP_ENV;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
    let publicKey = key.startsWith("sb_publishable_");
    if (key.split(".").length === 3) {
      publicKey =
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
          .role === "anon";
    }
    if (
      !publicKey ||
      !["staging", "production"].includes(environment ?? "") ||
      origin.protocol !== "https:" ||
      origin.origin !== process.env.APP_ORIGIN ||
      supabase.protocol !== "https:" ||
      supabase.username ||
      supabase.password ||
      supabase.search ||
      supabase.hash ||
      supabase.pathname !== "/" ||
      origin.username ||
      origin.password ||
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      ["localhost", "127.0.0.1", "[::1]"].includes(supabase.hostname) ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      (process.env.RATE_LIMIT_SECRET?.length ?? 0) < 32 ||
      process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
      process.env.DEMO_MODE === "true" ||
      (process.env.VERCEL_ENV === "production" &&
        environment !== "production") ||
      (process.env.VERCEL_ENV === "preview" && environment !== "staging")
    )
      throw new Error();
  } catch {
    throw new ApiError("UNAVAILABLE");
  }
}
export function publicConfig() {
  assertProductionConfig();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ApiError("UNAVAILABLE");
  return { url, key };
}
export async function userClient() {
  const { url, key } = publicConfig();
  const jar = await cookies();
  return createServerClient<Database>(url, key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server Components cannot set cookies; the route/proxy owns refresh. */
        }
      },
    },
  });
}
/** Privileged client. Use only after explicit user authorization or for HMAC-based login limiting. */
export function adminClient() {
  const { url } = publicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new ApiError("UNAVAILABLE");
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function requireCEO() {
  const client = await userClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new ApiError("UNAUTHENTICATED");
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw new ApiError("UNAUTHENTICATED");
  if (
    assurance.data.nextLevel === "aal2" &&
    assurance.data.currentLevel !== "aal2"
  )
    throw new ApiError("MFA_REQUIRED");
  const { data: authorized, error: denied } =
    await client.rpc("ceo_authorized");
  if (denied || !authorized) throw new ApiError("FORBIDDEN");
  return { client, user };
}
export function assertOrigin(request: Request) {
  assertProductionConfig();
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new ApiError("UNAVAILABLE");
  let origin: string;
  try {
    origin = new URL(expected).origin;
  } catch {
    throw new ApiError("UNAVAILABLE");
  }
  if (request.headers.get("origin") !== origin) throw new ApiError("FORBIDDEN");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError("FORBIDDEN");
}

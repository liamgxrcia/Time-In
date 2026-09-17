import { randomUUID, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  userClient,
  adminClient,
  assertOrigin,
  requireCEO,
} from "@/lib/server/supabase";
import { execute } from "@/lib/server/repository";
import { readJSON } from "@/lib/server/validation";
import { ApiError, errorResponse, logEvent } from "@/lib/server/errors";
import { resolveAdminEmail } from "@/lib/server/admin-identity";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    assertOrigin(request);
    const { operation } = await params;
    if (operation === "logout") {
      const { client } = await requireCEO();
      await execute(client, {
        operationId: requestId,
        command: { type: "security.event", event: "sign_out" },
      });
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new ApiError("UNAVAILABLE");
      return NextResponse.json(
        { data: { signedOut: true }, error: null, requestId },
        { headers },
      );
    }
    if (operation === "mfa") {
      const parsed = z
        .object({
          factorId: z.uuid(),
          challengeId: z.uuid(),
          code: z.string().regex(/^\d{6}$/),
        })
        .strict()
        .safeParse(await readJSON(request, 4096));
      if (!parsed.success) throw new ApiError("VALIDATION");
      const client = await userClient();
      const identity = await client.auth.getUser();
      if (identity.error || !identity.data.user)
        throw new ApiError("UNAUTHENTICATED");
      const limiterSecret = process.env.RATE_LIMIT_SECRET;
      if (!limiterSecret || limiterSecret.length < 32)
        throw new ApiError("UNAVAILABLE");
      const limiterKey = createHmac("sha256", limiterSecret)
        .update("mfa:" + identity.data.user.id)
        .digest("hex");
      const allowance = await adminClient().rpc("consume_auth_limit", {
        p_key: limiterKey,
      });
      if (allowance.error) throw new ApiError("UNAVAILABLE");
      if (!allowance.data) throw new ApiError("RATE_LIMITED");
      const verified = await client.auth.mfa.verify(parsed.data);
      if (verified.error) throw new ApiError("MFA_REQUIRED");
      const authorized = await requireCEO();
      await execute(authorized.client, {
        operationId: requestId,
        command: { type: "security.event", event: "sign_in" },
      });
      return NextResponse.json(
        { data: { authenticated: true }, error: null, requestId },
        { headers },
      );
    }
    if (operation !== "login") throw new ApiError("NOT_FOUND");
    const body = z
      .object({
        username: z.string().trim().min(1).max(320),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .safeParse(await readJSON(request, 4096));
    if (!body.success) throw new ApiError("VALIDATION");
    const email = resolveAdminEmail(body.data.username);
    if (!email) throw new ApiError("UNAUTHENTICATED");
    const secret = process.env.RATE_LIMIT_SECRET;
    if (!secret || secret.length < 32) throw new ApiError("UNAVAILABLE");
    const key = createHmac("sha256", secret)
      .update(body.data.username.trim().toLowerCase())
      .digest("hex");
    const { data: allowed, error: limitError } = await adminClient().rpc(
      "consume_auth_limit",
      { p_key: key },
    );
    if (limitError) throw new ApiError("UNAVAILABLE");
    if (!allowed) throw new ApiError("RATE_LIMITED");
    const client = await userClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password: body.data.password });
    if (error || !data.user) throw new ApiError("UNAUTHENTICATED");
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw new ApiError("UNAUTHENTICATED");
    if (
      assurance.data.nextLevel === "aal2" &&
      assurance.data.currentLevel !== "aal2"
    ) {
      const factors = await client.auth.mfa.listFactors();
      const factor = factors.data?.totp.find((f) => f.status === "verified");
      if (factors.error || !factor) throw new ApiError("MFA_REQUIRED");
      const challenge = await client.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challenge.error) throw new ApiError("MFA_REQUIRED");
      return NextResponse.json(
        {
          data: {
            requiresMfa: true,
            factorId: factor.id,
            challengeId: challenge.data.id,
          },
          error: null,
          requestId,
        },
        { headers },
      );
    }
    const { data: authorized, error: authError } =
      await client.rpc("ceo_authorized");
    if (authError || !authorized) {
      await client.auth.signOut({ scope: "local" });
      throw new ApiError("UNAUTHENTICATED");
    }
    await execute(client, {
      operationId: requestId,
      command: { type: "security.event", event: "sign_in" },
    });
    return NextResponse.json(
      { data: { authenticated: true }, error: null, requestId },
      { headers },
    );
  } catch (error) {
    const failure = errorResponse(error, requestId);
    logEvent("auth.failure", requestId, failure.body.error?.code);
    return NextResponse.json(failure.body, { status: failure.status, headers });
  }
}

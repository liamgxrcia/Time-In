import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCEO, adminClient, assertOrigin } from "@/lib/server/supabase";
import { execute, limit } from "@/lib/server/repository";
import { readJSON } from "@/lib/server/validation";
import { ApiError, errorResponse } from "@/lib/server/errors";
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
    const { client, user } = await requireCEO();
    await limit(client, "file");
    const body = z
      .object({ id: z.uuid() })
      .strict()
      .safeParse(await readJSON(request));
    if (!body.success) throw new ApiError("VALIDATION");
    const { data: file, error } = await client
      .from("file_agreements")
      .select("*")
      .eq("id", body.data.id)
      .eq("owner_id", user.id)
      .single();
    if (error || !file) throw new ApiError("FILE_ACCESS");
    const { operation } = await params;
    if (!["access", "upload"].includes(operation))
      throw new ApiError("NOT_FOUND");
    if (operation === "access") {
      if (file.status !== "available") throw new ApiError("FILE_ACCESS");
      await execute(client, {
        operationId: randomUUID(),
        command: {
          type: "security.event",
          event: "file_access",
          targetId: file.id,
        },
      });
      const signed = await adminClient()
        .storage.from("agreements")
        .createSignedUrl(file.storage_path, 60, {
          download: file.display_name,
        });
      if (signed.error) throw new ApiError("FILE_ACCESS");
      return NextResponse.json(
        {
          data: { url: signed.data.signedUrl, expiresIn: 60 },
          error: null,
          requestId,
        },
        { headers },
      );
    }
    if (operation === "upload") {
      if (file.status !== "pending") throw new ApiError("FILE_ACCESS");
      await execute(client, {
        operationId: randomUUID(),
        command: {
          type: "security.event",
          event: "file_upload",
          targetId: file.id,
        },
      });
      const signed = await adminClient()
        .storage.from("agreements")
        .createSignedUploadUrl(file.storage_path, {
          upsert: false,
        });
      if (signed.error) throw new ApiError("FILE_ACCESS");
      return NextResponse.json(
        {
          data: {
            url: signed.data.signedUrl,
            path: signed.data.path,
            token: signed.data.token,
          },
          error: null,
          requestId,
        },
        { headers },
      );
    }
    throw new ApiError("NOT_FOUND");
  } catch (error) {
    const failure = errorResponse(error, requestId);
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: {
        ...headers,
        ...(failure.status === 429 ? { "Retry-After": "60" } : {}),
      },
    });
  }
}

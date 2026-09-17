import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCEO, assertOrigin } from "@/lib/server/supabase";
import {
  snapshot,
  execute,
  limit,
  selectOnboarding,
} from "@/lib/server/repository";
import {
  today,
  health,
  recommendation,
  report,
  search,
} from "@/lib/server/queries";
import { previewImport } from "@/lib/server/import";
import {
  parseCommand,
  parseUUID,
  readJSON,
  validTimeZone,
} from "@/lib/server/validation";
import { ApiError, errorResponse, logEvent } from "@/lib/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
type Context = { params: Promise<{ operation: string }> };
async function handle(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const { operation } = await context.params;
    if (request.method !== "GET") assertOrigin(request);
    const { client } = await requireCEO();
    await limit(client, request.method === "GET" ? "read" : "mutation");
    let data: unknown;
    if (request.method === "POST") {
      if (operation === "command") {
        const payload = parseCommand(await readJSON(request));
        data = await execute(client, payload);
      } else if (operation === "import-preview") {
        const body = z
          .object({
            csv: z.string().max(1048576),
            mapping: z
              .object({
                name: z.string(),
                email: z.string().optional(),
                phone: z.string().optional(),
              })
              .strict(),
          })
          .strict()
          .safeParse(await readJSON(request));
        if (!body.success) throw new ApiError("VALIDATION");
        data = previewImport(
          body.data.csv,
          body.data.mapping,
          await snapshot(client),
        );
      } else throw new ApiError("NOT_FOUND");
    } else {
      const params = new URL(request.url).searchParams;
      if (operation === "notification-preferences") {
        const response = await client
          .from("notification_preferences")
          .select("email_enabled,web_push_enabled,revision")
          .maybeSingle();
        if (response.error) throw new ApiError("INTERNAL");
        data = {
          emailEnabled: response.data?.email_enabled ?? false,
          webPushEnabled: response.data?.web_push_enabled ?? false,
          deliveryAvailable: false,
          revision: response.data?.revision ?? 0,
        };
      } else if (operation === "system")
        data = {
          database: "available",
          notifications: "not_implemented",
          offlineCapture: "not_implemented",
          cloudSync: "online_api",
          environment: process.env.APP_ENV ?? "local",
        };
      else {
        const db = await snapshot(client);
        switch (operation) {
          case "onboarding":
            data = selectOnboarding(db, parseUUID(params.get("personId")));
            break;
          case "snapshot":
            data = db;
            break;
          case "today":
            data = today(
              db,
              new Date(),
              validTimeZone(params.get("timeZone") ?? "UTC"),
            );
            break;
          case "search":
            data = search(db, params.get("q") ?? "");
            break;
          case "health":
            data = params.has("personId")
              ? health(db, parseUUID(params.get("personId")))
              : db.people
                  .filter((p) => !p.archivedAt && !p.mergedInto)
                  .map((p) => health(db, p.id));
            break;
          case "recommendations":
            data = recommendation(db, parseUUID(params.get("personId")));
            break;
          case "reports":
            data = report(
              db,
              params.get("start") ?? "",
              params.get("end") ?? "",
              validTimeZone(params.get("timeZone") ?? "UTC"),
            );
            break;
          default:
            throw new ApiError("NOT_FOUND");
        }
      }
    }
    return NextResponse.json({ data, error: null, requestId }, { headers });
  } catch (error) {
    const failure = errorResponse(error, requestId);
    logEvent("api.failure", requestId, failure.body.error?.code);
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: {
        ...headers,
        ...(failure.status === 429 ? { "Retry-After": "60" } : {}),
      },
    });
  }
}
export const GET = handle;
export const POST = handle;

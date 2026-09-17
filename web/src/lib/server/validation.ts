import { z } from "zod";
import { stages, type CommandRequest } from "@/contracts/crm";
import { ApiError } from "./errors";
const uuid = z.uuid();
const text = z.string().trim().min(1).max(10000);
const name = z.string().trim().min(1).max(200);
const date = z.iso.datetime({ offset: true });
const revision = z.number().int().nonnegative();
const next = z
  .object({
    type: z.enum(["call", "message", "meeting", "review", "onboarding"]),
    dueAt: date,
    ownerId: uuid.optional(),
  })
  .strict();
const emails = z.array(z.email().max(320)).max(20);
const phones = z.array(z.string().max(40)).max(20);
const recurrence = z
  .object({
    unit: z.enum(["day", "week", "month"]),
    interval: z.number().int().min(1).max(365),
  })
  .strict();
const mutable = { id: uuid, expectedRevision: revision };
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("person.create"),
      name,
      emails: emails.optional(),
      phones: phones.optional(),
      notes: z.string().max(10000).optional(),
      consentNote: z.string().max(10000).optional(),
      source: z.enum(["manual", "referral", "imported"]).optional(),
      sourceNote: z.string().max(10000).optional(),
      communicationRestricted: z.boolean().optional(),
      organizationId: uuid.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("person.update"),
      ...mutable,
      name,
      emails,
      phones,
      notes: z.string().max(10000),
      consentNote: z.string().max(10000),
      sourceNote: z.string().max(10000).optional(),
      communicationRestricted: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("person.archive"), ...mutable }).strict(),
  z
    .object({
      type: z.literal("person.merge"),
      sourceId: uuid,
      targetId: uuid,
      sourceRevision: revision,
      expectedRevision: revision,
    })
    .strict(),
  z
    .object({
      type: z.literal("organization.create"),
      name,
      notes: z.string().max(10000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("organization.update"),
      ...mutable,
      name,
      notes: z.string().max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("lifecycle.transition"),
      ...mutable,
      stage: z.enum(stages),
      nextAction: next.optional(),
      reason: text.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("next_action.schedule"),
      ...mutable,
      nextAction: next,
    })
    .strict(),
  z
    .object({
      type: z.literal("activity.create"),
      personId: uuid,
      kind: z.enum(["call", "message", "meeting", "note", "email"]),
      summary: z.string().max(10000),
      outcome: z
        .enum([
          "no_answer",
          "follow_up",
          "interested",
          "not_interested",
          "completed",
        ])
        .optional(),
      nextAction: next.optional(),
      scriptVersionId: uuid.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("onboarding.start"),
      personId: uuid,
      dueAt: date,
      templateId: uuid,
      templateVersion: z.number().int().positive(),
      items: z
        .array(z.object({ title: name, required: z.boolean() }).strict())
        .min(1)
        .max(100),
      blockers: z.array(name).max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("onboarding.item"),
      ...mutable,
      itemId: uuid,
      waiverReason: text.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("onboarding.decide"),
      ...mutable,
      approve: z.boolean(),
      rationale: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("task.create"),
      personId: uuid,
      title: name,
      dueAt: date,
      priority: z.enum(["low", "normal", "high"]).optional(),
      recurrence: recurrence.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("task.complete"), ...mutable, evidence: text })
    .strict(),
  z
    .object({ type: z.literal("task.snooze"), ...mutable, dueAt: date })
    .strict(),
  z
    .object({ type: z.literal("task.cancel"), ...mutable, reason: text })
    .strict(),
  z
    .object({
      type: z.literal("script.publish"),
      scriptId: uuid.optional(),
      expectedVersion: z.number().int().positive().optional(),
      name,
      stage: z.enum(stages),
      content: text,
      disclosures: z.string().max(10000),
      changeNote: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("referral.create"),
      referrerId: uuid,
      personId: uuid,
      sourceNote: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("relationship.create"),
      fromId: uuid,
      toId: uuid,
      kind: z.enum(["introduced_by", "works_with", "related_to"]),
      explanation: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("client.review"),
      expectedRevision: revision,
      personId: uuid,
      reviewAt: date,
      risks: z.array(name).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("import.commit"),
      rows: z
        .array(
          z
            .object({
              row: z.number().int().min(2),
              name: z.string().max(200),
              email: z.string().max(320),
              phone: z.string().max(40),
              choice: z.enum(["create", "skip", "merge"]),
              targetId: uuid.optional(),
              expectedRevision: revision.optional(),
              allowDuplicate: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(1000),
    })
    .strict(),
  z.object({ type: z.literal("import.rollback"), id: uuid }).strict(),
  z
    .object({
      type: z.literal("notification.preferences"),
      expectedRevision: revision,
      emailEnabled: z.boolean(),
      webPushEnabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("file.register"),
      personId: uuid,
      displayName: z.string().trim().min(1).max(255),
      mimeType: z.enum([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "text/plain",
      ]),
      size: z.number().int().positive().max(20971520),
      expiresAt: date.optional(),
    })
    .strict(),
  z.object({ type: z.literal("file.finalize"), ...mutable }).strict(),
  z
    .object({
      type: z.literal("security.event"),
      event: z.enum([
        "sign_in",
        "sign_out",
        "file_access",
        "file_upload",
        "export",
      ]),
      targetId: uuid.optional(),
    })
    .strict(),
]);
export function parseCommand(value: unknown): CommandRequest {
  const result = z
    .object({ operationId: uuid, command: commandSchema })
    .strict()
    .safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION");
  const command = result.data.command;
  if (
    command.type === "script.publish" &&
    Boolean(command.scriptId) !== (command.expectedVersion !== undefined)
  )
    throw new ApiError("VALIDATION");
  if (command.type === "import.commit") {
    if (
      new Set(command.rows.map((row) => row.row)).size !== command.rows.length
    )
      throw new ApiError("IMPORT_INVALID");
    if (
      command.rows.some(
        (row) =>
          row.choice === "merge" &&
          (!row.targetId || row.expectedRevision === undefined),
      )
    )
      throw new ApiError("VALIDATION");
  }
  return result.data;
}
export function parseUUID(value: unknown): string {
  const result = uuid.safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION");
  return result.data;
}
export function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    throw new ApiError("VALIDATION");
  }
}
export async function readJSON(
  request: Request,
  maximum = 1_048_576,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError("VALIDATION");
  if (Number(request.headers.get("content-length") ?? 0) > maximum)
    throw new ApiError("VALIDATION");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("VALIDATION");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new ApiError("VALIDATION");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("VALIDATION");
  }
}

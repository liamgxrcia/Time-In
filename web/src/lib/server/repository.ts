import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/contracts/database.types";
import type {
  Snapshot,
  ChecklistItem,
  Task,
  ClientAccount,
  CommandRequest,
  CommandResult,
  OnboardingCase,
} from "@/contracts/crm";
import { ApiError, databaseError } from "./errors";
export type UserDatabaseClient = SupabaseClient<Database>;
export async function limit(
  client: UserDatabaseClient,
  scope: "read" | "mutation" | "file",
) {
  const { data, error } = await client.rpc("consume_request_limit", {
    p_scope: scope,
  });
  if (error) throw databaseError(error);
  if (!data) throw new ApiError("RATE_LIMITED");
}
export async function execute(
  client: UserDatabaseClient,
  request: CommandRequest,
): Promise<CommandResult> {
  const { data, error } = await client.rpc("crm_command", {
    p_operation: request.operationId,
    p_command: request.command as unknown as Json,
  });
  if (error) throw databaseError(error);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string"
  )
    throw new ApiError("INTERNAL");
  return data as unknown as CommandResult;
}
export async function snapshot(client: UserDatabaseClient): Promise<Snapshot> {
  type Table = keyof Database["public"]["Tables"];
  const { data: raw, error: readError } = await client.rpc("crm_snapshot");
  if (readError) throw databaseError(readError);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ApiError("INTERNAL");
  const records: Record<string, Json | undefined> = raw;
  async function all<T extends Table>(
    table: T,
  ): Promise<Database["public"]["Tables"][T]["Row"][]> {
    const rows = records[table];
    if (!Array.isArray(rows)) throw new ApiError("INTERNAL");
    if (rows.length > 2000) throw new ApiError("VALIDATION");
    return rows as unknown as Database["public"]["Tables"][T]["Row"][];
  }
  const [
    people,
    leads,
    organizations,
    onboarding,
    clients,
    activities,
    tasks,
    scripts,
    versions,
    referrals,
    files,
    audit,
    relationships,
    integrations,
    imports,
    history,
  ] = await Promise.all([
    all("people"),
    all("lead_profiles"),
    all("organizations"),
    all("onboarding_cases"),
    all("client_accounts"),
    all("activities"),
    all("tasks"),
    all("scripts"),
    all("script_versions"),
    all("referrals"),
    all("file_agreements"),
    all("audit_events"),
    all("relationship_edges"),
    all("integration_connections"),
    all("import_batches"),
    all("lifecycle_history"),
  ]);
  const leadByPerson = new Map(leads.map((x) => [x.person_id, x]));
  const scriptByID = new Map(scripts.map((x) => [x.id, x]));
  return {
    people: people.map((p) => {
      const l = leadByPerson.get(p.id);
      if (!l) throw new ApiError("INTERNAL");
      return {
        id: p.id,
        source: p.source as "manual" | "imported" | "referral" | "system",
        name: p.name,
        emails: p.emails,
        phones: p.phones,
        notes: p.notes,
        tags: p.tags,
        organizationId: p.organization_id,
        sourceNote: p.source_note,
        consentNote: p.consent_note,
        consentRecordedAt: p.consent_recorded_at,
        consentRecordedBy: p.consent_recorded_by,
        currentOnboardingCaseId:
          onboarding.find(
            (o) => o.person_id === p.id && o.decision !== "rejected",
          )?.id ?? null,
        communicationRestricted: p.communication_restricted,
        stage: l.stage,
        priority: l.priority as "low" | "normal" | "high",
        nextAction:
          l.next_action_type && l.next_action_at
            ? {
                type: l.next_action_type,
                dueAt: l.next_action_at,
                ownerId: l.next_action_owner_id!,
              }
            : null,
        lastContactAt: l.last_contact_at,
        stageEnteredAt: l.stage_entered_at,
        reason: l.reason,
        revision: p.revision,
        archivedAt: p.archived_at,
        mergedInto: p.merged_into,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      };
    }),
    organizations: organizations.map((x) => ({
      id: x.id,
      name: x.name,
      notes: x.notes,
      revision: x.revision,
    })),
    onboarding: onboarding.map((x) => ({
      id: x.id,
      personId: x.person_id,
      createdAt: x.created_at,
      templateId: x.template_id,
      templateVersion: x.template_version,
      items: x.items as unknown as ChecklistItem[],
      blockers: x.blockers as unknown as ChecklistItem[],
      decision: x.decision as "pending" | "approved" | "rejected",
      rationale: x.rationale,
      decidedAt: x.decided_at,
      dueAt: x.due_at,
      revision: x.revision,
    })),
    clients: clients.map((x) => ({
      revision: x.revision,
      id: x.id,
      personId: x.person_id,
      approvedAt: x.approved_at,
      reviewAt: x.review_at,
      risks: x.risks,
      healthOverride:
        x.health_override as unknown as ClientAccount["healthOverride"],
    })),
    activities: activities.map((x) => ({
      id: x.id,
      personId: x.person_id,
      kind: x.kind as Snapshot["activities"][number]["kind"],
      summary: x.summary,
      outcome: x.outcome,
      scriptVersionId: x.script_version_id,
      createdAt: x.created_at,
    })),
    tasks: tasks.map((x) => ({
      id: x.id,
      personId: x.person_id,
      title: x.title,
      dueAt: x.due_at,
      priority: x.priority as Task["priority"],
      status: x.status as Task["status"],
      recurrence: x.recurrence as unknown as Task["recurrence"],
      completedAt: x.completed_at,
      evidence: x.evidence,
      revision: x.revision,
    })),
    scripts: versions.map((x) => {
      const script = scriptByID.get(x.script_id);
      if (!script) throw new ApiError("INTERNAL");
      return {
        id: x.id,
        scriptId: x.script_id,
        name: script.name,
        stage: script.stage,
        version: x.version,
        content: x.content,
        disclosures: x.disclosures,
        changeNote: x.change_note,
        effectiveAt: x.effective_at,
      };
    }),
    referrals: referrals.map((x) => ({
      id: x.id,
      referrerId: x.referrer_id,
      personId: x.person_id,
      sourceNote: x.source_note,
      createdAt: x.created_at,
    })),
    files: files.map((x) => ({
      revision: x.revision,
      id: x.id,
      personId: x.person_id,
      displayName: x.display_name,
      status: x.status as "pending" | "available" | "archived",
      mimeType: x.mime_type,
      size: x.size,
      expiresAt: x.expires_at,
      createdAt: x.created_at,
    })),
    audit: audit.map((x) => ({
      actorId: x.owner_id,
      metadata: x.metadata as Record<string, unknown>,
      id: x.id,
      targetId: x.target_id,
      action: x.action,
      operationId: x.operation_id,
      createdAt: x.created_at,
    })),
    relationships: relationships.map((x) => ({
      id: x.id,
      fromId: x.from_id,
      toId: x.to_id,
      kind: x.kind,
      explanation: x.explanation,
    })),
    integrations: integrations.map((x) => ({
      id: x.id,
      provider: x.provider,
      health: x.health as "disconnected" | "healthy" | "warning",
      lastSync: x.last_sync,
    })),
    imports: imports.map((x) => ({
      results: x.results as unknown as Snapshot["imports"][number]["results"],
      revision: x.revision,
      id: x.id,
      status: x.status as "committed" | "rolled_back",
      createdAt: x.created_at,
      rowCount: x.row_count,
    })),
    lifecycleHistory: history.map((x) => ({
      reason: x.reason,
      nextAction:
        x.next_action as unknown as Snapshot["lifecycleHistory"][number]["nextAction"],
      operationId: x.operation_id,
      id: x.id,
      personId: x.person_id,
      fromStage: x.from_stage,
      toStage: x.to_stage,
      createdAt: x.created_at,
    })),
  };
}

/** No array-order assumption: rejected cases are history, never current. */
export function selectOnboarding(
  db: Snapshot,
  personId: string,
): { current: OnboardingCase | null; history: OnboardingCase[] } {
  if (
    !db.people.some((p) => p.id === personId && !p.archivedAt && !p.mergedInto)
  )
    throw new ApiError("NOT_FOUND");
  const history = db.onboarding
    .filter((o) => o.personId === personId)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
  return {
    current:
      history.find(
        (o) => o.decision === "pending" || o.decision === "approved",
      ) ?? null,
    history,
  };
}

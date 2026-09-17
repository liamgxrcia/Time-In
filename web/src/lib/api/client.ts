import type { ApiResponse, CommandResult, HealthResult, QueueItem as CRMQueueItem, Report, Snapshot, CommandRequest, ImportPreview, NotificationPreferences, SystemHealth, FileUpload } from "@/contracts/crm";
import type { Activity, DashboardData, Person, Stage } from "@/lib/domain";
import { fixtureMode } from "@/lib/demo-mode";

export class ApiError extends Error { constructor(public status: number, message: string, public code = "INTERNAL") { super(message); } }

const stageFromAPI = (stage: Snapshot["people"][number]["stage"]): Stage => stage.replaceAll("_", "-") as Stage;
const stageToAPI = (stage: Stage): Snapshot["people"][number]["stage"] => stage.replaceAll("-", "_") as Snapshot["people"][number]["stage"];

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { credentials: "same-origin", ...init, headers: { "content-type": "application/json", ...init?.headers } }); }
  catch { throw new ApiError(0, "The network connection was interrupted.", "OFFLINE"); }
  const envelope = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !envelope || envelope.error) throw new ApiError(response.status, envelope?.error?.message ?? "The request could not be completed.", envelope?.error?.code ?? "INTERNAL");
  return envelope.data;
}
export const get = <T>(operation: string) => request<T>(`/api/crm/${operation}`);
export async function execute(requestBody: CommandRequest): Promise<CommandResult> {
  if (fixtureMode) throw new ApiError(400, "Demo data is read-only. Connect the backend to save changes.", "DEMO_READ_ONLY");
  return request<CommandResult>("/api/crm/command", { method: "POST", body: JSON.stringify(requestBody) });
}
export function canonicalID(snapshot: Snapshot, id: string): string {
  const seen = new Set<string>();
  while (!seen.has(id)) { seen.add(id); const next = snapshot.people.find(p => p.id === id)?.mergedInto; if (!next) return id; id = next; }
  throw new ApiError(409, "This merged record needs review.", "CONFLICT");
}

export function toViewModel(snapshot: Snapshot, queue: CRMQueueItem[], health: HealthResult[], report: Report): DashboardData {
  const organizations = new Map(snapshot.organizations.map((item) => [item.id, item.name]));
  const onboarding = new Map(snapshot.onboarding.map((item) => [item.id, item]));
  const clients = new Map(snapshot.clients.map((item) => [item.personId, item]));
  const healthByPerson = new Map(health.map((item) => [item.personId, item]));
  const people: Person[] = snapshot.people.filter((item) => !item.archivedAt && !item.mergedInto).map((item) => {
    const nameParts = item.name.split(/\s+/); const caseData = item.currentOnboardingCaseId ? onboarding.get(item.currentOnboardingCaseId) : undefined; const client = clients.get(item.id); const result = healthByPerson.get(item.id);
    return { id: item.id, revision: item.revision, name: item.name, initials: nameParts.slice(0, 2).map((part) => part[0]).join("").toUpperCase(), email: item.emails[0], phone: item.phones[0], organization: item.organizationId ? organizations.get(item.organizationId) : undefined, stage: stageFromAPI(item.stage), stageEnteredAt: item.stageEnteredAt, priority: item.priority, source: item.source, nextAction: item.nextAction ?? undefined, lastContactAt: item.lastContactAt ?? undefined, health: result?.state.replaceAll("_", "-") as Person["health"] ?? "unknown", healthExplanation: result?.explanation ?? "Relationship health has not been evaluated", tags: item.tags, consentNote: item.consentNote || undefined, communicationRestricted: item.communicationRestricted, notes: item.notes || undefined, risks: client?.risks ?? [], reviewAt: client?.reviewAt ?? undefined, onboarding: caseData ? { revision: caseData.revision, id: caseData.id, personId: caseData.personId, templateVersion: caseData.templateVersion, dueAt: caseData.dueAt, decision: caseData.decision, rationale: caseData.rationale ?? undefined, items: caseData.items.map((entry) => ({ ...entry, waiverReason: entry.waiverReason ?? undefined })), blockers: caseData.blockers.map((entry) => ({ ...entry, waiverReason: entry.waiverReason ?? undefined })) } : undefined };
  });
  const converted = new Set(snapshot.clients.map((item) => item.personId));
  return {
    snapshot, report,
    generatedAt: new Date().toISOString(), people,
    queue: queue.map((item) => ({ id: item.id, personId: item.personId, taskId: item.taskId, category: item.category.replaceAll("_", "-") as DashboardData["queue"][number]["category"], score: item.score, reason: item.reason, recommendedAction: item.recommendedAction, date: item.dueAt })),
    tasks: snapshot.tasks.map((item) => ({ id: item.id, revision: item.revision, personId: item.personId, title: item.title, dueAt: item.dueAt, priority: item.priority, status: item.status, recurrence: item.recurrence ? `${item.recurrence.interval > 1 ? `${item.recurrence.interval} ` : ""}${item.recurrence.unit}${item.recurrence.interval > 1 ? "s" : ""}` : undefined, evidence: item.evidence ?? undefined })),
    activities: snapshot.activities.map((item) => ({ id: item.id, personId: canonicalID(snapshot, item.personId), kind: item.kind.replaceAll("_", "-") as Activity["kind"], summary: item.summary, at: item.createdAt })),
    referrals: snapshot.referrals.map((item) => ({ id: item.id, referrerId: canonicalID(snapshot, item.referrerId), personId: canonicalID(snapshot, item.personId), at: item.createdAt, status: converted.has(canonicalID(snapshot, item.personId)) ? "converted" : snapshot.activities.some((activity) => canonicalID(snapshot, activity.personId) === canonicalID(snapshot, item.personId) && ["call", "message", "meeting", "email"].includes(activity.kind)) ? "contacted" : "awaiting-outreach", sourceNote: item.sourceNote })),
    scripts: snapshot.scripts.map((item) => ({ id: item.id, familyId: item.scriptId, name: item.name, stage: stageFromAPI(item.stage), campaign: "Approved talking points", version: item.version, content: item.content, disclosures: item.disclosures, effectiveAt: item.effectiveAt, changeNote: item.changeNote })),
    audit: snapshot.audit.map((item) => ({ id: item.id, action: item.action, at: item.createdAt, targetId: item.targetId ?? "system" })),
    integrations: snapshot.integrations.map((item) => ({ id: item.id, provider: item.provider, health: item.health, explanation: item.health === "healthy" ? "Connection is healthy." : "Connection needs review; manual workflows remain available." })),
    trends: Object.entries(report.activityByDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, activity]) => ({ date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`)), activity, approvals: snapshot.lifecycleHistory.filter(h => h.toStage === "active" && new Date(h.createdAt).toLocaleDateString("en-CA") === date).length })),
    imports: snapshot.imports.map((item) => ({ id: item.id, filename: "Approved source import", at: item.createdAt, rows: item.rowCount, valid: item.rowCount, duplicates: item.results.filter(row => row.action === "merged").length, status: item.status === "rolled_back" ? "rolled-back" : "committed" })),
  };
}

async function dashboard(): Promise<DashboardData> {
  if (fixtureMode) return structuredClone((await import("@/lib/fixtures")).fixtureData);
  const end = new Date(); const start = new Date(end.getTime() - 30 * 86_400_000); const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [snapshot, queue, report] = await Promise.all([get<Snapshot>("snapshot"), get<CRMQueueItem[]>(`today?timeZone=${encodeURIComponent(timeZone)}`), get<Report>(`reports?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&timeZone=${encodeURIComponent(timeZone)}`)]);
  const health = await get<HealthResult[]>("health");
  return toViewModel(snapshot, queue, health, report);
}

export const api = {
  dashboard, execute,
  previewImport: (csv: string, mapping: { name: string; email?: string; phone?: string }) => request<ImportPreview>("/api/crm/import-preview", { method: "POST", body: JSON.stringify({ csv, mapping }) }),
  preferences: () => get<NotificationPreferences>("notification-preferences"),
  system: () => get<SystemHealth>("system"),
  uploadURL: (id: string) => request<FileUpload>("/api/crm/files/upload", { method: "POST", body: JSON.stringify({ id }) }),
  fileURL: (id: string) => request<{ url: string; expiresIn: number }>("/api/crm/files/access", { method: "POST", body: JSON.stringify({ id }) }),
  logout: () => request<{ signedOut: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
};
export { stageToAPI };

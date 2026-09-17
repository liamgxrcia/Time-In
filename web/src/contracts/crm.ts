/** Browser-safe API contracts. Dates are ISO-8601 UTC strings; identifiers are UUIDs. */
export type UUID = string;
export type ISODate = string;
export const stages = [
  "new",
  "follow_up",
  "pending_signup",
  "active",
  "paused",
  "not_interested",
  "closed",
] as const;
export type Stage = (typeof stages)[number];
export type ActionType =
  "call" | "message" | "meeting" | "review" | "onboarding";
export type Priority = "low" | "normal" | "high";
export type HealthState =
  "strong" | "stable" | "needs_attention" | "at_risk" | "unknown";
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MISSING_NEXT_ACTION"
  | "INVALID_TRANSITION"
  | "ONBOARDING_INCOMPLETE"
  | "DUPLICATE"
  | "IMPORT_INVALID"
  | "ROLLBACK_CONFLICT"
  | "RATE_LIMITED"
  | "FILE_ACCESS"
  | "UNAVAILABLE"
  | "INTERNAL";
export type ApiResponse<T> =
  | { data: T; error: null; requestId: string }
  | {
      data: null;
      error: { code: ErrorCode; message: string; retryable: boolean };
      requestId: string;
    };
export interface NextAction {
  type: ActionType;
  dueAt: ISODate;
  ownerId: UUID;
}
export type NextActionInput = Omit<NextAction, "ownerId"> & { ownerId?: UUID };
export interface Person {
  id: UUID;
  source: "manual" | "imported" | "referral" | "system";
  name: string;
  emails: string[];
  phones: string[];
  notes: string;
  tags: string[];
  organizationId: UUID | null;
  sourceNote: string;
  consentNote: string;
  consentRecordedAt: ISODate | null;
  consentRecordedBy: UUID | null;
  currentOnboardingCaseId: UUID | null;
  communicationRestricted: boolean;
  stage: Stage;
  priority: Priority;
  nextAction: NextAction | null;
  lastContactAt: ISODate | null;
  stageEnteredAt: ISODate;
  reason: string | null;
  revision: number;
  archivedAt: ISODate | null;
  mergedInto: UUID | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}
export interface Organization {
  id: UUID;
  name: string;
  notes: string;
  revision: number;
}
export interface ChecklistItem {
  id: UUID;
  title: string;
  required: boolean;
  completed: boolean;
  waiverReason: string | null;
}
export interface OnboardingCase {
  id: UUID;
  personId: UUID;
  createdAt: ISODate;
  templateId: UUID;
  templateVersion: number;
  items: ChecklistItem[];
  blockers: ChecklistItem[];
  decision: "pending" | "approved" | "rejected";
  rationale: string | null;
  decidedAt: ISODate | null;
  dueAt: ISODate;
  revision: number;
}
export interface ClientAccount {
  revision: number;
  id: UUID;
  personId: UUID;
  approvedAt: ISODate;
  reviewAt: ISODate | null;
  risks: string[];
  healthOverride: { state: HealthState; reason: string } | null;
}
export interface Activity {
  id: UUID;
  personId: UUID;
  kind:
    | "call"
    | "message"
    | "meeting"
    | "note"
    | "email"
    | "stage_change"
    | "onboarding"
    | "task_completion"
    | "referral"
    | "file"
    | "decision";
  summary: string;
  outcome: string | null;
  scriptVersionId: UUID | null;
  createdAt: ISODate;
}
export interface Task {
  id: UUID;
  personId: UUID;
  title: string;
  dueAt: ISODate;
  priority: Priority;
  status: "open" | "completed" | "cancelled";
  recurrence: { unit: "day" | "week" | "month"; interval: number } | null;
  completedAt: ISODate | null;
  evidence: string | null;
  revision: number;
}
export interface ScriptVersion {
  id: UUID;
  scriptId: UUID;
  name: string;
  stage: Stage;
  version: number;
  content: string;
  disclosures: string;
  changeNote: string;
  effectiveAt: ISODate;
}
export interface Referral {
  id: UUID;
  referrerId: UUID;
  personId: UUID;
  sourceNote: string;
  createdAt: ISODate;
}
export interface FileAgreement {
  revision: number;
  id: UUID;
  personId: UUID;
  displayName: string;
  status: "pending" | "available" | "archived";
  mimeType: string;
  size: number;
  expiresAt: ISODate | null;
  createdAt: ISODate;
}
export interface AuditEvent {
  actorId: UUID;
  metadata: Record<string, unknown>;
  id: UUID;
  targetId: UUID | null;
  action: string;
  operationId: UUID;
  createdAt: ISODate;
}
export interface RelationshipEdge {
  id: UUID;
  fromId: UUID;
  toId: UUID;
  kind: string;
  explanation: string;
}
export interface IntegrationConnection {
  id: UUID;
  provider: string;
  health: "disconnected" | "healthy" | "warning";
  lastSync: ISODate | null;
}
export interface ImportResultRow {
  row: number;
  action: "created" | "merged" | "skipped";
  personId: UUID | null;
}
export interface ImportBatch {
  results: ImportResultRow[];
  revision: number;
  id: UUID;
  status: "committed" | "rolled_back";
  createdAt: ISODate;
  rowCount: number;
}
export interface LifecycleHistory {
  reason: string | null;
  nextAction: NextAction | null;
  operationId: UUID;
  id: UUID;
  personId: UUID;
  fromStage: Stage;
  toStage: Stage;
  createdAt: ISODate;
}
export interface Snapshot {
  people: Person[];
  organizations: Organization[];
  onboarding: OnboardingCase[];
  clients: ClientAccount[];
  activities: Activity[];
  tasks: Task[];
  scripts: ScriptVersion[];
  referrals: Referral[];
  files: FileAgreement[];
  audit: AuditEvent[];
  relationships: RelationshipEdge[];
  integrations: IntegrationConnection[];
  imports: ImportBatch[];
  lifecycleHistory: LifecycleHistory[];
}
export interface QueueItem {
  id: string;
  personId: UUID;
  taskId?: UUID;
  category: string;
  score: number;
  reason: string;
  dueAt: ISODate;
  recommendedAction: string;
  accessibleLabel: string;
  destination: string;
}
export interface HealthResult {
  personId: UUID;
  calculated: HealthState;
  state: HealthState;
  label: string;
  explanation: string;
  factors: string[];
  evaluatedAt: ISODate;
  recommendedAction: string;
}
export interface Recommendation {
  personId: UUID;
  explanation: string;
  action: string;
  scriptVersionId: UUID | null;
}
export interface SearchResult {
  id: UUID;
  kind: string;
  title: string;
  personId: UUID | null;
  score: number;
}
export interface ImportRow {
  row: number;
  name: string;
  email: string;
  phone: string;
  errors: string[];
  duplicates: { id: UUID; confidence: number; reasons: string[] }[];
}
export interface ImportPreview {
  rows: ImportRow[];
  validCount: number;
  duplicateCount: number;
}
export interface Report {
  start: ISODate;
  end: ISODate;
  activeClients: number;
  newApprovals: number;
  closures: number;
  calls: number;
  referrals: number;
  convertedReferrals: number;
  dueTasks: number;
  onTimeTasks: number;
  taskCompletionRate: number | null;
  stages: Record<Stage, number>;
  health: Record<HealthState, number>;
  activityByDay: Record<string, number>;
  stageMovement: Record<string, number>;
  averageDaysInStage: Partial<Record<Stage, number>>;
  overdueFollowUps: number;
  stalledRecords: number;
  onboardingPending: number;
  onboardingBlocked: number;
  reviewsOverdue: number;
  dataQualityIssues: number;
  integrationWarnings: number;
  retention: {
    activeAtStart: number;
    retainedAtEnd: number;
    rate: number | null;
  };
  comparison: {
    start: ISODate;
    end: ISODate;
    calls: number;
    newApprovals: number;
    closures: number;
    referrals: number;
  };
}
export type Command =
  | {
      type: "person.create";
      name: string;
      emails?: string[];
      phones?: string[];
      notes?: string;
      source?: "manual" | "referral" | "imported";
      sourceNote?: string;
      communicationRestricted?: boolean;
      consentNote?: string;
      organizationId?: UUID;
    }
  | {
      type: "person.update";
      id: UUID;
      expectedRevision: number;
      name: string;
      emails: string[];
      phones: string[];
      notes: string;
      consentNote: string;
      sourceNote?: string;
      communicationRestricted?: boolean;
    }
  | { type: "person.archive"; id: UUID; expectedRevision: number }
  | {
      type: "person.merge";
      sourceId: UUID;
      targetId: UUID;
      expectedRevision: number;
      sourceRevision: number;
    }
  | { type: "organization.create"; name: string; notes?: string }
  | {
      type: "organization.update";
      id: UUID;
      expectedRevision: number;
      name: string;
      notes: string;
    }
  | {
      type: "lifecycle.transition";
      id: UUID;
      expectedRevision: number;
      stage: Stage;
      nextAction?: NextActionInput;
      reason?: string;
    }
  | {
      type: "next_action.schedule";
      id: UUID;
      expectedRevision: number;
      nextAction: NextActionInput;
    }
  | {
      type: "activity.create";
      personId: UUID;
      kind: "call" | "message" | "meeting" | "note" | "email";
      summary: string;
      outcome?:
        | "no_answer"
        | "follow_up"
        | "interested"
        | "not_interested"
        | "completed";
      nextAction?: NextActionInput;
      scriptVersionId?: UUID;
    }
  | {
      type: "onboarding.start";
      personId: UUID;
      dueAt: ISODate;
      templateId: UUID;
      templateVersion: number;
      items: { title: string; required: boolean }[];
      blockers?: string[];
    }
  | {
      type: "onboarding.item";
      id: UUID;
      expectedRevision: number;
      itemId: UUID;
      waiverReason?: string;
    }
  | {
      type: "onboarding.decide";
      id: UUID;
      expectedRevision: number;
      approve: boolean;
      rationale: string;
    }
  | {
      type: "task.create";
      personId: UUID;
      title: string;
      dueAt: ISODate;
      priority?: Priority;
      recurrence?: { unit: "day" | "week" | "month"; interval: number };
    }
  | {
      type: "task.complete";
      id: UUID;
      expectedRevision: number;
      evidence: string;
    }
  | { type: "task.snooze"; id: UUID; expectedRevision: number; dueAt: ISODate }
  | { type: "task.cancel"; id: UUID; expectedRevision: number; reason: string }
  | {
      type: "script.publish";
      scriptId?: UUID;
      expectedVersion?: number;
      name: string;
      stage: Stage;
      content: string;
      disclosures: string;
      changeNote: string;
    }
  | {
      type: "referral.create";
      referrerId: UUID;
      personId: UUID;
      sourceNote: string;
    }
  | {
      type: "relationship.create";
      fromId: UUID;
      toId: UUID;
      kind: "introduced_by" | "works_with" | "related_to";
      explanation: string;
    }
  | {
      type: "client.review";
      expectedRevision: number;
      personId: UUID;
      reviewAt: ISODate;
      risks: string[];
    }
  | {
      type: "import.commit";
      rows: {
        row: number;
        name: string;
        email: string;
        phone: string;
        choice: "create" | "skip" | "merge";
        targetId?: UUID;
        expectedRevision?: number;
        allowDuplicate?: boolean;
      }[];
    }
  | { type: "import.rollback"; id: UUID }
  | {
      type: "notification.preferences";
      expectedRevision: number;
      emailEnabled: boolean;
      webPushEnabled: boolean;
    }
  | {
      type: "file.register";
      personId: UUID;
      displayName: string;
      mimeType: string;
      size: number;
      expiresAt?: ISODate;
    }
  | { type: "file.finalize"; id: UUID; expectedRevision: number }
  | {
      type: "security.event";
      event: "sign_in" | "sign_out" | "file_access" | "file_upload" | "export";
      targetId?: UUID;
    };
export interface CommandRequest {
  operationId: UUID;
  command: Command;
}
export interface NotificationPreferences {
  emailEnabled: boolean;
  webPushEnabled: boolean;
  revision: number;
  deliveryAvailable: false;
}
export interface SystemHealth {
  database: "available";
  notifications: "not_implemented";
  offlineCapture: "not_implemented";
  cloudSync: "online_api";
  environment: string;
}
export interface FileUpload {
  url: string;
  path: string;
  token: string;
}
export interface CommandResult {
  id: UUID;
  revision?: number;
  personId?: UUID;
  personRevision?: number;
  scriptId?: UUID;
  version?: number;
  nextTaskId?: UUID;
  importRows?: ImportResultRow[];
}

/** Every method returns the same stable envelope. See docs/frontend-contract.md. */
export interface CRMClient {
  snapshot(): Promise<ApiResponse<Snapshot>>;
  system(): Promise<ApiResponse<SystemHealth>>;
  healthAll(): Promise<ApiResponse<HealthResult[]>>;
  onboarding(
    personId: UUID,
  ): Promise<
    ApiResponse<{ current: OnboardingCase | null; history: OnboardingCase[] }>
  >;
  notificationPreferences(): Promise<ApiResponse<NotificationPreferences>>;
  uploadFile(id: UUID): Promise<ApiResponse<FileUpload>>;
  execute(request: CommandRequest): Promise<ApiResponse<CommandResult>>;
  today(): Promise<ApiResponse<QueueItem[]>>;
  search(query: string): Promise<ApiResponse<SearchResult[]>>;
  health(personId: UUID): Promise<ApiResponse<HealthResult>>;
  recommendations(personId: UUID): Promise<ApiResponse<Recommendation>>;
  previewImport(
    csv: string,
    mapping: { name: string; email?: string; phone?: string },
  ): Promise<ApiResponse<ImportPreview>>;
  report(
    start: ISODate,
    end: ISODate,
    timeZone: string,
  ): Promise<ApiResponse<Report>>;
  fileUrl(id: UUID): Promise<ApiResponse<{ url: string; expiresIn: number }>>;
}

import type { Snapshot, Report } from "@/contracts/crm";
export const stages = ["new", "follow-up", "pending-signup", "active", "paused", "not-interested", "closed"] as const;
export type Stage = (typeof stages)[number];
export type Priority = "low" | "normal" | "high";
export type Health = "strong" | "stable" | "needs-attention" | "at-risk" | "unknown";
export type ActionType = "call" | "message" | "meeting" | "review" | "onboarding";

export interface NextAction { type: ActionType; dueAt: string }
export interface ChecklistItem { id: string; title: string; required: boolean; completed: boolean; waiverReason?: string }
export interface OnboardingCase { revision?: number; id: string; personId: string; templateVersion: number; dueAt: string; appointment?: string; decision: "pending" | "approved" | "rejected"; rationale?: string; items: ChecklistItem[]; blockers: ChecklistItem[] }
export interface Person {
  id: string; revision?: number; name: string; initials: string; email?: string; phone?: string; organization?: string;
  stage: Stage; stageEnteredAt: string; priority: Priority; source: "manual" | "imported" | "referral" | "system";
  nextAction?: NextAction; lastContactAt?: string; health: Health; healthExplanation: string;
  tags: string[]; consentNote?: string; communicationRestricted?: boolean; notes?: string;
  risks: string[]; reviewAt?: string; onboarding?: OnboardingCase;
}
export interface Activity { id: string; personId: string; kind: "call" | "message" | "meeting" | "note" | "stage-change" | "task" | "referral" | "decision"; summary: string; at: string }
export interface Task { id: string; revision?: number; personId: string; title: string; dueAt: string; priority: Priority; status: "open" | "completed" | "cancelled"; recurrence?: string; evidence?: string }
export interface Referral { id: string; referrerId: string; personId: string; at: string; status: "awaiting-outreach" | "contacted" | "converted"; sourceNote: string }
export interface Script { id: string; familyId: string; name: string; stage: Stage; campaign: string; version: number; content: string; disclosures: string; effectiveAt: string; retirementAt?: string; changeNote: string }
export interface QueueItem { id: string; personId: string; category: "overdue-follow-up" | "due-today" | "onboarding-blocker" | "overdue-commitment" | "relationship" | "review" | "stalled" | "missing-action" | "risk" | "referral"; score: number; reason: string; recommendedAction: string; date: string; taskId?: string }
export interface AuditEvent { id: string; action: string; at: string; targetId: string }
export interface Integration { id: string; provider: string; health: "disconnected" | "healthy" | "warning"; explanation: string }
export interface TrendPoint { date: string; activity: number; approvals: number }
export interface ImportBatch { id: string; filename: string; at: string; rows: number; valid: number; duplicates: number; status: "preview" | "committed" | "rolled-back" }
export interface DashboardData {
  snapshot?: Snapshot; report?: Report;
  generatedAt: string; people: Person[]; queue: QueueItem[]; tasks: Task[]; activities: Activity[];
  referrals: Referral[]; scripts: Script[]; audit: AuditEvent[]; integrations: Integration[];
  trends: TrendPoint[]; imports: ImportBatch[];
}

export const stageLabel: Record<Stage, string> = {
  "new": "New / Uncontacted", "follow-up": "Follow-Up", "pending-signup": "Pending Signup",
  "active": "Approved / Active", "paused": "Paused", "not-interested": "Not Interested", "closed": "Closed / Offboarded",
};
export const healthLabel: Record<Health, string> = {
  strong: "Strong", stable: "Stable", "needs-attention": "Needs attention", "at-risk": "At risk", unknown: "Unknown",
};

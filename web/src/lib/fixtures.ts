import type { DashboardData, Person } from "./domain";

const onboarding = {
  id: "onboarding-casey", personId: "casey-blake", templateVersion: 3, dueAt: "2026-09-17T17:00:00Z", appointment: "2026-09-16T19:00:00Z", decision: "pending" as const,
  items: [
    { id: "consent", title: "Record consent and contact preferences", required: true, completed: true },
    { id: "expectations", title: "Confirm service expectations", required: true, completed: true },
    { id: "agreement", title: "Review client agreement", required: true, completed: false },
  ],
  blockers: [{ id: "legal-review", title: "Agreement language awaiting review", required: true, completed: false }],
};

export const fixturePeople: Person[] = [
  { id: "alex-rowan", name: "Alex Rowan", initials: "AR", email: "alex.rowan@example.com", phone: "+1 212 555 0101", organization: "Rowan Studio", stage: "new", stageEnteredAt: "2026-09-15T14:00:00Z", priority: "normal", source: "manual", nextAction: { type: "call", dueAt: "2026-09-16T15:00:00Z" }, health: "unknown", healthExplanation: "No meaningful contact recorded", tags: ["introduction"], risks: [], notes: "Met at a private client dinner." },
  { id: "jordan-ellis", name: "Jordan Ellis", initials: "JE", email: "jordan.ellis@example.com", phone: "+1 646 555 0112", stage: "follow-up", stageEnteredAt: "2026-09-04T16:00:00Z", priority: "high", source: "referral", nextAction: { type: "call", dueAt: "2026-09-14T14:30:00Z" }, lastContactAt: "2026-09-04T16:00:00Z", health: "needs-attention", healthExplanation: "Follow-up is two days overdue", tags: ["referred", "priority"], risks: [], consentNote: "Permission to call provided by referrer." },
  { id: "taylor-morgan", name: "Taylor Morgan", initials: "TM", email: "taylor.morgan@example.com", stage: "follow-up", stageEnteredAt: "2026-09-09T12:00:00Z", priority: "normal", source: "imported", lastContactAt: "2026-09-09T12:00:00Z", health: "unknown", healthExplanation: "Required next action is missing", tags: ["import review"], risks: [] },
  { id: "casey-blake", name: "Casey Blake", initials: "CB", email: "casey.blake@example.com", phone: "+1 917 555 0193", organization: "Blake & Co.", stage: "pending-signup", stageEnteredAt: "2026-09-12T17:00:00Z", priority: "high", source: "referral", nextAction: { type: "onboarding", dueAt: "2026-09-16T19:00:00Z" }, lastContactAt: "2026-09-12T17:00:00Z", health: "needs-attention", healthExplanation: "Onboarding has one unresolved blocker", tags: ["onboarding"], risks: [], onboarding },
  { id: "riley-hart", name: "Riley Hart", initials: "RH", email: "riley.hart@example.com", phone: "+1 212 555 0148", organization: "Hart Advisory", stage: "active", stageEnteredAt: "2026-07-18T10:00:00Z", priority: "normal", source: "manual", nextAction: { type: "review", dueAt: "2026-09-21T16:00:00Z" }, lastContactAt: "2026-09-12T16:00:00Z", health: "strong", healthExplanation: "Meaningful contact four days ago; no overdue commitments", tags: ["long-term"], risks: [], reviewAt: "2026-09-21T16:00:00Z" },
  { id: "drew-parker", name: "Drew Parker", initials: "DP", email: "drew.parker@example.com", stage: "paused", stageEnteredAt: "2026-08-23T13:00:00Z", priority: "low", source: "manual", nextAction: { type: "review", dueAt: "2026-10-15T14:00:00Z" }, lastContactAt: "2026-08-23T13:00:00Z", health: "stable", healthExplanation: "Paused at the client’s request with a review scheduled", tags: ["paused"], risks: [] },
  { id: "sam-avery", name: "Sam Avery", initials: "SA", email: "sam.avery@example.com", stage: "not-interested", stageEnteredAt: "2026-09-02T15:00:00Z", priority: "normal", source: "manual", lastContactAt: "2026-09-02T15:00:00Z", health: "unknown", healthExplanation: "Relationship is not in active pursuit", tags: [], risks: [] },
  { id: "morgan-reed", name: "Morgan Reed", initials: "MR", email: "morgan.reed@example.com", phone: "+1 917 555 0174", organization: "Reed Partners", stage: "active", stageEnteredAt: "2026-05-05T10:00:00Z", priority: "high", source: "referral", nextAction: { type: "meeting", dueAt: "2026-09-18T17:00:00Z" }, lastContactAt: "2026-07-02T17:00:00Z", health: "at-risk", healthExplanation: "Last meaningful contact 76 days ago; one overdue commitment; one unresolved risk", tags: ["priority", "quarterly review"], risks: ["Service expectations require clarification"], reviewAt: "2026-09-05T16:00:00Z" },
  { id: "quinn-hayes", name: "Quinn Hayes", initials: "QH", email: "quinn.hayes@example.com", stage: "new", stageEnteredAt: "2026-09-15T18:00:00Z", priority: "high", source: "referral", nextAction: { type: "call", dueAt: "2026-09-16T18:00:00Z" }, health: "unknown", healthExplanation: "Referral awaiting first contact", tags: ["referral"], consentNote: "Referrer confirmed permission to make an introduction.", risks: [] },
  { id: "jamie-brook", name: "Jamie Brook", initials: "JB", email: "jamie.brook@example.com", stage: "closed", stageEnteredAt: "2026-07-21T12:00:00Z", priority: "normal", source: "manual", lastContactAt: "2026-07-21T12:00:00Z", health: "unknown", healthExplanation: "Relationship closed and retained read-only", tags: ["offboarded"], risks: [] },
];

export const fixtureData: DashboardData = {
  generatedAt: "2026-09-16T14:05:00Z",
  people: fixturePeople,
  queue: [
    { id: "q-risk", personId: "morgan-reed", category: "risk", score: 120, reason: "Unresolved client risk", recommendedAction: "Review the risk and prepare the client meeting", date: "2026-07-02T17:00:00Z" },
    { id: "q-commitment", personId: "morgan-reed", category: "overdue-commitment", score: 115, reason: "Commitment is overdue", recommendedAction: "Complete or reschedule the service review", date: "2026-09-15T14:00:00Z", taskId: "task-review" },
    { id: "q-missing", personId: "taylor-morgan", category: "missing-action", score: 110, reason: "Required next action is missing", recommendedAction: "Schedule the next action", date: "2026-09-09T12:00:00Z" },
    { id: "q-overdue", personId: "jordan-ellis", category: "overdue-follow-up", score: 106, reason: "Follow-up is two days overdue", recommendedAction: "Complete or reschedule the call", date: "2026-09-14T14:30:00Z" },
    { id: "q-blocker", personId: "casey-blake", category: "onboarding-blocker", score: 100, reason: "Onboarding has an unresolved blocker", recommendedAction: "Review the agreement blocker", date: "2026-09-17T17:00:00Z" },
    { id: "q-referral", personId: "quinn-hayes", category: "referral", score: 92, reason: "Referral awaiting first contact", recommendedAction: "Review the source and call Quinn", date: "2026-09-16T18:00:00Z" },
    { id: "q-today", personId: "alex-rowan", category: "due-today", score: 82, reason: "Call due today", recommendedAction: "Open context and record the outcome", date: "2026-09-16T15:00:00Z" },
    { id: "q-review", personId: "riley-hart", category: "review", score: 64, reason: "Client review is upcoming", recommendedAction: "Prepare the relationship review", date: "2026-09-21T16:00:00Z" },
  ],
  tasks: [
    { id: "task-review", personId: "morgan-reed", title: "Monthly service review", dueAt: "2026-09-15T14:00:00Z", priority: "high", status: "open", recurrence: "Monthly" },
    { id: "task-agreement", personId: "casey-blake", title: "Confirm agreement review", dueAt: "2026-09-17T17:00:00Z", priority: "high", status: "open" },
    { id: "task-brief", personId: "riley-hart", title: "Prepare quarterly review brief", dueAt: "2026-09-20T16:00:00Z", priority: "normal", status: "open", recurrence: "Quarterly" },
    { id: "task-note", personId: "jordan-ellis", title: "Send agreed follow-up note", dueAt: "2026-09-14T17:00:00Z", priority: "normal", status: "completed", evidence: "Message logged Sep 14" },
  ],
  activities: [
    { id: "a1", personId: "jordan-ellis", kind: "call", summary: "Discussed service needs; requested a follow-up this week.", at: "2026-09-04T16:00:00Z" },
    { id: "a2", personId: "casey-blake", kind: "meeting", summary: "Onboarding call completed; agreement review remains open.", at: "2026-09-12T17:00:00Z" },
    { id: "a3", personId: "riley-hart", kind: "note", summary: "Client confirmed current service priorities.", at: "2026-09-12T16:00:00Z" },
    { id: "a4", personId: "morgan-reed", kind: "task", summary: "Monthly service review became overdue.", at: "2026-09-15T14:00:00Z" },
  ],
  referrals: [
    { id: "ref-quinn", referrerId: "riley-hart", personId: "quinn-hayes", at: "2026-09-15T18:00:00Z", status: "awaiting-outreach", sourceNote: "Permission granted for an introduction" },
    { id: "ref-casey", referrerId: "morgan-reed", personId: "casey-blake", at: "2026-09-08T14:00:00Z", status: "contacted", sourceNote: "Warm introduction by email" },
    { id: "ref-riley", referrerId: "jordan-ellis", personId: "riley-hart", at: "2026-06-22T14:00:00Z", status: "converted", sourceNote: "Professional introduction" },
  ],
  scripts: [
    { id: "script-intro-v2", familyId: "script-intro", name: "Introduction", stage: "new", campaign: "Private introduction", version: 2, content: "Confirm this is a convenient time. Ask what a valuable relationship would look like. Agree on one clear next step.", disclosures: "Confirm permission to keep relationship notes.", effectiveAt: "2026-09-01T12:00:00Z", changeNote: "Simplified opening and clarified consent." },
    { id: "script-intro-v1", familyId: "script-intro", name: "Introduction", stage: "new", campaign: "Private introduction", version: 1, content: "Introduce the service and ask about current needs.", disclosures: "Confirm permission to follow up.", effectiveAt: "2026-05-01T12:00:00Z", retirementAt: "2026-09-01T12:00:00Z", changeNote: "Initial approved version." },
    { id: "script-followup-v3", familyId: "script-followup", name: "Relationship follow-up", stage: "follow-up", campaign: "Service continuity", version: 3, content: "Reconnect to the last conversation, confirm what changed, and agree on timing for the next action.", disclosures: "Respect recorded communication preferences.", effectiveAt: "2026-08-20T12:00:00Z", changeNote: "Added continuity prompt." },
  ],
  audit: [
    { id: "audit-1", action: "onboarding.started", at: "2026-09-12T17:00:00Z", targetId: "casey-blake" },
    { id: "audit-2", action: "referral.created", at: "2026-09-15T18:00:00Z", targetId: "quinn-hayes" },
    { id: "audit-3", action: "task.completed", at: "2026-09-14T16:40:00Z", targetId: "task-note" },
  ],
  integrations: [{ id: "calendar", provider: "Calendar", health: "warning", explanation: "Connection has not been configured. Manual scheduling remains available." }],
  trends: [
    { date: "Sep 10", activity: 6, approvals: 0 }, { date: "Sep 11", activity: 8, approvals: 1 }, { date: "Sep 12", activity: 11, approvals: 0 },
    { date: "Sep 13", activity: 4, approvals: 0 }, { date: "Sep 14", activity: 7, approvals: 1 }, { date: "Sep 15", activity: 9, approvals: 0 }, { date: "Sep 16", activity: 5, approvals: 0 },
  ],
  imports: [{ id: "batch-september", filename: "relationship-review.csv", at: "2026-09-09T13:00:00Z", rows: 24, valid: 21, duplicates: 3, status: "preview" }],
};

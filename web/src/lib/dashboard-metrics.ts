import type { DashboardData, Person } from "@/lib/domain";

const DAY = 86_400_000;
const TERMINAL_STAGES = new Set(["closed", "not-interested"]);
const ACTION_STAGES = new Set(["follow-up", "pending-signup"]);

export type DashboardException = {
  id: string;
  title: string;
  detail: string;
  href: string;
  severity: "high" | "normal";
  kind: "risk" | "next-action" | "onboarding" | "freshness" | "task";
};

export type DashboardMetrics = {
  activeClients: number;
  newApprovals: number;
  newApprovalsDelta: number;
  referralContribution: number;
  referralContributionDelta: number;
  needsAttention: number;
  nextActionCoverage: number;
  followUpCompletion: number;
  onboardingVisibility: number;
  activeFreshness: number;
  health: { strong: number; stable: number; needsAttention: number; atRisk: number };
  overdueCommitments: number;
  onboardingBlockers: number;
  nextReview: Person | null;
  exceptions: DashboardException[];
};

function percent(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 100;
}

function sortByDate(a: Person, b: Person) {
  return Date.parse(a.reviewAt ?? "") - Date.parse(b.reviewAt ?? "");
}

export function dashboardMetrics(data: DashboardData, now = new Date()): DashboardMetrics {
  const report = data.report;
  const active = data.people.filter((person) => person.stage === "active");
  const openPeople = data.people.filter((person) => !TERMINAL_STAGES.has(person.stage));
  const pendingSignup = data.people.filter((person) => person.stage === "pending-signup");
  const pendingWithOnboarding = pendingSignup.filter((person) => Boolean(person.onboarding));
  const freshActive = active.filter((person) => person.lastContactAt && +now - Date.parse(person.lastContactAt) <= 30 * DAY);
  const completedTasks = data.tasks.filter((task) => task.status === "completed");
  const dueTasks = data.tasks.filter((task) => task.status !== "cancelled" && Date.parse(task.dueAt) <= +now);
  const onTimeTasks = dueTasks.filter((task) => task.status === "completed" && task.evidence);
  const currentHealth = {
    strong: active.filter((person) => person.health === "strong").length,
    stable: active.filter((person) => person.health === "stable").length,
    needsAttention: active.filter((person) => person.health === "needs-attention").length,
    atRisk: active.filter((person) => person.health === "at-risk").length,
  };
  const health = report
    ? {
        strong: report.health.strong,
        stable: report.health.stable,
        needsAttention: report.health.needs_attention,
        atRisk: report.health.at_risk,
      }
    : currentHealth;
  const newApprovals = report?.newApprovals ?? data.snapshot?.lifecycleHistory.filter((event) => event.toStage === "active").length ?? 0;
  const previousApprovals = report?.comparison.newApprovals ?? 0;
  const convertedReferrals = report?.convertedReferrals ?? data.referrals.filter((referral) => referral.status === "converted").length;
  const activeClients = report?.activeClients ?? active.length;
  const referralContribution = percent(convertedReferrals, activeClients);
  const previousReferralContribution = percent(report?.comparison.referrals ?? 0, activeClients);
  const scheduledReviews = active.filter((person) => person.reviewAt);
  const exceptions: DashboardException[] = [];

  for (const person of data.people) {
    if (person.risks.length) {
      exceptions.push({ id: `${person.id}:risk`, title: "Unresolved client risk", detail: `${person.name} · ${person.risks[0]}`, href: `/people/${person.id}`, severity: "high", kind: "risk" });
    }
    if (ACTION_STAGES.has(person.stage) && !person.nextAction) {
      exceptions.push({ id: `${person.id}:next-action`, title: "Required next action missing", detail: `${person.name} · ${person.stage === "follow-up" ? "Follow-up" : "Onboarding"} record incomplete`, href: `/people/${person.id}`, severity: "high", kind: "next-action" });
    }
    if (person.onboarding?.decision === "pending" && [...person.onboarding.items, ...person.onboarding.blockers].some((item) => !item.completed && !item.waiverReason)) {
      exceptions.push({ id: `${person.id}:onboarding`, title: "Onboarding blocked", detail: `${person.name} · required item remains open`, href: `/people/${person.id}`, severity: "high", kind: "onboarding" });
    }
    if (person.stage === "active" && (!person.lastContactAt || +now - Date.parse(person.lastContactAt) > 30 * DAY)) {
      exceptions.push({ id: `${person.id}:freshness`, title: "Active relationship needs contact", detail: `${person.name} · no meaningful contact in the last 30 days`, href: `/people/${person.id}`, severity: "normal", kind: "freshness" });
    }
  }
  for (const task of data.tasks.filter((item) => item.status === "open" && Date.parse(item.dueAt) < +now)) {
    const person = data.people.find((candidate) => candidate.id === task.personId);
    if (person) exceptions.push({ id: `${task.id}:overdue`, title: "Overdue commitment", detail: `${person.name} · ${task.title}`, href: `/people/${person.id}`, severity: "high", kind: "task" });
  }

  return {
    activeClients,
    newApprovals,
    newApprovalsDelta: newApprovals - previousApprovals,
    referralContribution,
    referralContributionDelta: referralContribution - previousReferralContribution,
    needsAttention: health.needsAttention + health.atRisk,
    nextActionCoverage: percent(openPeople.filter((person) => person.nextAction).length, openPeople.length),
    followUpCompletion: report?.taskCompletionRate !== null && report?.taskCompletionRate !== undefined ? Math.round(report.taskCompletionRate * 100) : percent(onTimeTasks.length, dueTasks.length || completedTasks.length),
    onboardingVisibility: percent(pendingWithOnboarding.length, pendingSignup.length),
    activeFreshness: percent(freshActive.length, active.length),
    health,
    overdueCommitments: data.queue.filter((item) => item.category === "overdue-commitment").length,
    onboardingBlockers: data.queue.filter((item) => item.category === "onboarding-blocker").length,
    nextReview: scheduledReviews.filter((person) => Date.parse(person.reviewAt!) >= +now).sort(sortByDate)[0] ?? scheduledReviews.sort(sortByDate)[0] ?? null,
    exceptions: exceptions.slice(0, 8),
  };
}

export function formatDelta(value: number, unit = "than prior period") {
  if (!value) return "Unchanged from prior period";
  return `${Math.abs(value)} ${value > 0 ? "more" : "fewer"} ${unit}`;
}

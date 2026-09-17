import {
  stages,
  type Snapshot,
  type Person,
  type HealthResult,
  type HealthState,
  type QueueItem,
  type Recommendation,
  type SearchResult,
  type Report,
} from "@/contracts/crm";
import { ApiError } from "./errors";
const day = 86400000;
const terminal = (p: Person) => ["closed", "not_interested"].includes(p.stage);
const visible = (p: Person) => !p.archivedAt && !p.mergedInto;
export function canonicalID(db: Snapshot, id: string): string {
  const people = new Map(db.people.map((p) => [p.id, p]));
  const visited = new Set<string>();
  let current = id;
  while (people.get(current)?.mergedInto) {
    if (visited.has(current)) throw new ApiError("CONFLICT");
    visited.add(current);
    current = people.get(current)!.mergedInto!;
  }
  return current;
}
export function health(
  db: Snapshot,
  personId: string,
  now = new Date(),
): HealthResult {
  const p = db.people.find((x) => x.id === personId && visible(x));
  if (!p) throw new ApiError("NOT_FOUND");
  const client = db.clients.find((x) => x.personId === p.id);
  const factors: string[] = [];
  let severity = 0;
  const age = p.lastContactAt
    ? Math.max(0, Math.floor((+now - Date.parse(p.lastContactAt)) / day))
    : null;
  factors.push(
    age === null
      ? "No meaningful contact recorded"
      : `Last meaningful contact ${age} days ago`,
  );
  if (age !== null) {
    if (age > 60) severity = 3;
    else if (age > 30) severity = 2;
  }
  const overdue = db.tasks.filter(
    (x) =>
      x.personId === p.id && x.status === "open" && Date.parse(x.dueAt) < +now,
  ).length;
  if (overdue) {
    factors.push(`${overdue} overdue commitments`);
    severity = Math.max(severity, overdue >= 3 ? 3 : 2);
  }
  if (client?.risks.length) {
    factors.push(`${client.risks.length} unresolved risks`);
    severity = 3;
  }
  if (client?.reviewAt && Date.parse(client.reviewAt) < +now) {
    factors.push("Client review is overdue");
    severity = Math.max(severity, 2);
  }
  if (
    db.onboarding.some(
      (x) =>
        x.personId === p.id &&
        x.decision === "pending" &&
        x.blockers.some((i) => !i.completed && !i.waiverReason),
    )
  ) {
    factors.push("Onboarding has unresolved blockers");
    severity = Math.max(severity, 2);
  }
  const calculated: HealthState =
    severity === 3
      ? "at_risk"
      : severity === 2
        ? "needs_attention"
        : age === null
          ? "unknown"
          : age <= 14
            ? "strong"
            : "stable";
  const state = client?.healthOverride?.state ?? calculated;
  const labels: Record<HealthState, string> = {
    at_risk: "At Risk",
    needs_attention: "Needs Attention",
    unknown: "Unknown",
    strong: "Strong",
    stable: "Stable",
  };
  return {
    personId: p.id,
    calculated,
    state,
    label: labels[state],
    explanation:
      factors.join("; ") +
      (client?.healthOverride
        ? `; CEO override: ${client.healthOverride.reason}`
        : ""),
    factors,
    evaluatedAt: now.toISOString(),
    recommendedAction: ["at_risk", "needs_attention", "unknown"].includes(state)
      ? "Review the relationship and schedule contact"
      : "Maintain the next planned review",
  };
}
export function dateKey(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function today(
  db: Snapshot,
  now = new Date(),
  timeZone = "UTC",
): QueueItem[] {
  const items: QueueItem[] = [];
  const todayKey = dateKey(now, timeZone);
  const tasks = new Map<string, Snapshot["tasks"]>();
  for (const t of db.tasks) {
    const existing = tasks.get(t.personId) ?? [];
    existing.push(t);
    tasks.set(t.personId, existing);
  }
  const clients = new Map(db.clients.map((x) => [x.personId, x]));
  const onboardings = new Map(
    db.onboarding
      .filter((x) => x.decision === "pending")
      .map((x) => [x.personId, x]),
  );
  function add(
    p: Person,
    category: string,
    base: number,
    date: string,
    reason: string,
    action: string,
    taskId?: string,
  ) {
    const age = Math.min(
      30,
      Math.max(0, Math.floor((+now - Date.parse(date)) / day)),
    );
    const score = base + { low: 0, normal: 10, high: 20 }[p.priority] + age;
    items.push({
      id: `${p.id}:${category}:${taskId ?? "person"}`,
      personId: p.id,
      ...(taskId ? { taskId } : {}),
      category,
      score,
      reason,
      dueAt: date,
      recommendedAction: action,
      accessibleLabel: `${reason}. ${action}`,
      destination: `/people/${p.id}`,
    });
  }
  for (const p of db.people.filter((p) => visible(p) && !terminal(p))) {
    if (p.nextAction) {
      const date = dateKey(p.nextAction.dueAt, timeZone);
      if (date < todayKey)
        add(
          p,
          "overdue_follow_up",
          90,
          p.nextAction.dueAt,
          "Next action is overdue",
          `Complete or reschedule ${p.nextAction.type}`,
        );
      else if (date === todayKey)
        add(
          p,
          "due_today",
          70,
          p.nextAction.dueAt,
          "Next action is due today",
          `Prepare the scheduled ${p.nextAction.type}`,
        );
    } else if (["follow_up", "pending_signup"].includes(p.stage))
      add(
        p,
        "missing_action",
        100,
        p.stageEnteredAt,
        "Required next action is missing",
        "Schedule the next action",
      );
    const o = onboardings.get(p.id);
    if (o?.blockers.some((i) => !i.completed && !i.waiverReason))
      add(
        p,
        "onboarding_blocker",
        85,
        o.dueAt,
        "Onboarding has unresolved blockers",
        "Review the checklist",
      );
    for (const t of tasks.get(p.id) ?? [])
      if (t.status === "open" && Date.parse(t.dueAt) < +now)
        add(
          p,
          "overdue_commitment",
          95,
          t.dueAt,
          "Commitment is overdue",
          "Complete or reschedule the commitment",
          t.id,
        );
    const c = clients.get(p.id);
    if (c && p.stage === "active") {
      if (c.risks.length)
        add(
          p,
          "risk",
          110,
          p.stageEnteredAt,
          "Unresolved client risk",
          "Review recorded risks",
        );
      if (c.reviewAt && Date.parse(c.reviewAt) <= +now + 7 * day)
        add(
          p,
          "review",
          60,
          c.reviewAt,
          "Client review is upcoming or overdue",
          "Prepare a relationship review",
        );
      if (!p.lastContactAt || +now - Date.parse(p.lastContactAt) > 30 * day)
        add(
          p,
          "relationship",
          75,
          p.lastContactAt ?? p.stageEnteredAt,
          "Client needs attention",
          "Schedule meaningful contact",
        );
    }
    if (
      ["new", "follow_up", "pending_signup"].includes(p.stage) &&
      +now - Date.parse(p.stageEnteredAt) > 14 * day
    )
      add(
        p,
        "stalled",
        50,
        p.stageEnteredAt,
        "No stage movement for more than 14 days",
        "Review status and next action",
      );
    const referral = db.referrals
      .filter((r) => canonicalID(db, r.personId) === p.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (
      p.stage === "new" &&
      referral &&
      Date.parse(p.nextAction?.dueAt ?? referral.createdAt) <= +now
    )
      add(
        p,
        "referral",
        65,
        referral.createdAt,
        "Referral awaiting first contact",
        "Review source and contact preferences",
      );
  }
  return items.sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(a.dueAt) - Date.parse(b.dueAt) ||
      a.id.localeCompare(b.id),
  );
}
export function recommendation(
  db: Snapshot,
  id: string,
  now = new Date(),
): Recommendation {
  const p = db.people.find((x) => x.id === id && visible(x));
  if (!p) throw new ApiError("NOT_FOUND");
  const script = db.scripts
    .filter((s) => s.stage === p.stage && Date.parse(s.effectiveAt) <= +now)
    .sort((a, b) => b.version - a.version || a.id.localeCompare(b.id))[0];
  if (p.communicationRestricted)
    return {
      personId: id,
      explanation: "Communication restrictions are recorded",
      action: "Review consent before outreach",
      scriptVersionId: null,
    };
  if (terminal(p))
    return {
      personId: id,
      explanation: "This relationship is closed to active work",
      action: "Review history or explicitly reopen",
      scriptVersionId: null,
    };
  if (p.stage === "pending_signup")
    return {
      personId: id,
      explanation: "Onboarding approval requires a CEO decision",
      action: "Review required items and blockers",
      scriptVersionId: script?.id ?? null,
    };
  const h = health(db, id, now);
  return {
    personId: id,
    explanation: h.explanation,
    action: p.nextAction
      ? `Prepare the scheduled ${p.nextAction.type}`
      : h.recommendedAction,
    scriptVersionId: script?.id ?? null,
  };
}
export function search(db: Snapshot, query: string): SearchResult[] {
  const q = query.trim().normalize("NFKD").toLowerCase();
  if (!q) return [];
  if (q.length > 200) throw new ApiError("VALIDATION");
  const results: SearchResult[] = [];
  function add(
    id: string,
    kind: string,
    title: string,
    body: string,
    personId: string | null,
  ) {
    const name = title.normalize("NFKD").toLowerCase();
    if (name.includes(q) || body.normalize("NFKD").toLowerCase().includes(q))
      results.push({
        id,
        kind,
        title,
        personId,
        score:
          name === q
            ? 100
            : name.startsWith(q)
              ? 80
              : name.includes(q)
                ? 60
                : 30,
      });
  }
  for (const p of db.people.filter(visible))
    add(
      p.id,
      "person",
      p.name,
      [...p.emails, ...p.phones, ...p.tags, p.notes, p.stage].join(" "),
      p.id,
    );
  for (const o of db.organizations)
    add(o.id, "organization", o.name, o.notes, null);
  for (const t of db.tasks)
    add(t.id, "task", t.title, t.evidence ?? "", canonicalID(db, t.personId));
  for (const a of db.activities)
    add(a.id, "activity", a.summary, a.kind, canonicalID(db, a.personId));
  for (const s of db.scripts) add(s.id, "script", s.name, s.content, null);
  for (const f of db.files)
    add(f.id, "file", f.displayName, "", canonicalID(db, f.personId));
  for (const r of db.referrals)
    add(
      r.id,
      "referral",
      "Referral",
      r.sourceNote,
      canonicalID(db, r.personId),
    );
  return results
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 100);
}
export function report(
  db: Snapshot,
  start: string,
  end: string,
  timeZone = "UTC",
  now = new Date(),
): Report {
  const from = Date.parse(start),
    to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw new ApiError("VALIDATION");
  const includes = (date: string) =>
    Date.parse(date) >= from && Date.parse(date) < to;
  const people = db.people.filter(visible);
  const activities = db.activities.filter((x) => includes(x.createdAt));
  const due = db.tasks.filter(
    (x) => x.status !== "cancelled" && includes(x.dueAt),
  );
  const onTime = due.filter(
    (x) =>
      x.status === "completed" &&
      x.completedAt &&
      Date.parse(x.completedAt) <= Date.parse(x.dueAt),
  );
  const referrals = db.referrals.filter((x) => includes(x.createdAt));
  const counts = Object.fromEntries(
    stages.map((stage) => [
      stage,
      people.filter((p) => p.stage === stage).length,
    ]),
  ) as Report["stages"];
  const distribution: Report["health"] = {
    strong: 0,
    stable: 0,
    needs_attention: 0,
    at_risk: 0,
    unknown: 0,
  };
  for (const p of people.filter((p) => p.stage === "active"))
    distribution[health(db, p.id, now).state]++;
  const byDay: Record<string, number> = {};
  for (const a of activities) {
    const key = dateKey(a.createdAt, timeZone);
    byDay[key] = (byDay[key] ?? 0) + 1;
  }
  const movement: Record<string, number> = {};
  for (const event of db.lifecycleHistory.filter((e) =>
    includes(e.createdAt),
  )) {
    const key = `${event.fromStage}:${event.toStage}`;
    movement[key] = (movement[key] ?? 0) + 1;
  }
  const durations = new Map<Person["stage"], number[]>();
  const eventsByPerson = new Map<string, Snapshot["lifecycleHistory"]>();
  for (const event of db.lifecycleHistory) {
    const rows = eventsByPerson.get(event.personId) ?? [];
    rows.push(event);
    eventsByPerson.set(event.personId, rows);
  }
  let activeAtStart = 0,
    retainedAtEnd = 0;
  for (const p of db.people.filter((p) => !p.mergedInto)) {
    const events = (eventsByPerson.get(p.id) ?? []).sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const stageAt = (time: number) => {
      if (Date.parse(p.createdAt) > time) return null;
      const earlier = events
        .filter((e) => Date.parse(e.createdAt) < time)
        .at(-1);
      if (earlier) return earlier.toStage;
      return events[0]?.fromStage ?? p.stage;
    };
    if (stageAt(from) === "active") {
      activeAtStart++;
      if (stageAt(to) === "active") retainedAtEnd++;
    }
    let cursor = Date.parse(p.createdAt),
      stage = events[0]?.fromStage ?? p.stage;
    for (const event of [
      ...events,
      { createdAt: new Date(Math.min(to, +now)).toISOString(), toStage: stage },
    ]) {
      const eventTime = Date.parse(event.createdAt);
      const overlap = Math.max(
        0,
        Math.min(eventTime, to, +now) - Math.max(cursor, from),
      );
      if (overlap > 0) {
        const list = durations.get(stage) ?? [];
        list.push(overlap / day);
        durations.set(stage, list);
      }
      cursor = eventTime;
      stage = event.toStage;
    }
  }
  const averageDaysInStage: Report["averageDaysInStage"] = {};
  for (const [stage, values] of durations)
    averageDaysInStage[stage] =
      values.reduce((sum, x) => sum + x, 0) / values.length;
  const pending = db.onboarding.filter((o) => o.decision === "pending");
  const previousStart = from - (to - from),
    previous = (date: string) =>
      Date.parse(date) >= previousStart && Date.parse(date) < from;
  const extra = {
    stageMovement: movement,
    averageDaysInStage,
    overdueFollowUps: people.filter(
      (p) =>
        p.stage === "follow_up" &&
        p.nextAction &&
        Date.parse(p.nextAction.dueAt) < +now,
    ).length,
    stalledRecords: people.filter(
      (p) =>
        ["new", "follow_up", "pending_signup"].includes(p.stage) &&
        +now - Date.parse(p.stageEnteredAt) > 14 * day,
    ).length,
    onboardingPending: pending.length,
    onboardingBlocked: pending.filter((o) =>
      o.blockers.some((i) => !i.completed && !i.waiverReason),
    ).length,
    reviewsOverdue: db.clients.filter(
      (c) =>
        c.reviewAt &&
        Date.parse(c.reviewAt) < +now &&
        people.some((p) => p.id === c.personId && p.stage === "active"),
    ).length,
    dataQualityIssues: people.filter(
      (p) =>
        (!p.emails.length && !p.phones.length) ||
        (["follow_up", "pending_signup"].includes(p.stage) && !p.nextAction),
    ).length,
    integrationWarnings: db.integrations.filter((i) => i.health === "warning")
      .length,
    retention: {
      activeAtStart,
      retainedAtEnd,
      rate: activeAtStart ? retainedAtEnd / activeAtStart : null,
    },
    comparison: {
      start: new Date(previousStart).toISOString(),
      end: start,
      calls: db.activities.filter(
        (a) => a.kind === "call" && previous(a.createdAt),
      ).length,
      newApprovals: db.lifecycleHistory.filter(
        (e) =>
          e.fromStage === "pending_signup" &&
          e.toStage === "active" &&
          previous(e.createdAt),
      ).length,
      closures: db.lifecycleHistory.filter(
        (e) => e.toStage === "closed" && previous(e.createdAt),
      ).length,
      referrals: db.referrals.filter((r) => previous(r.createdAt)).length,
    },
  };
  return {
    ...extra,
    start,
    end,
    activeClients: counts.active,
    newApprovals: db.lifecycleHistory.filter(
      (x) =>
        includes(x.createdAt) &&
        x.fromStage === "pending_signup" &&
        x.toStage === "active",
    ).length,
    closures: db.lifecycleHistory.filter(
      (x) => includes(x.createdAt) && x.toStage === "closed",
    ).length,
    calls: activities.filter((x) => x.kind === "call").length,
    referrals: referrals.length,
    convertedReferrals: referrals.filter((x) =>
      db.clients.some((c) => c.personId === canonicalID(db, x.personId)),
    ).length,
    dueTasks: due.length,
    onTimeTasks: onTime.length,
    taskCompletionRate: due.length ? onTime.length / due.length : null,
    stages: counts,
    health: distribution,
    activityByDay: byDay,
  };
}

import { describe, expect, it } from "vitest";
import { dashboardMetrics, formatDelta } from "@/lib/dashboard-metrics";
import { fixtureData } from "@/lib/fixtures";

describe("dashboard metrics", () => {
  it("derives operating measures and exceptions from current records", () => {
    const metrics = dashboardMetrics(fixtureData, new Date("2026-09-16T20:00:00Z"));

    expect(metrics.activeClients).toBe(2);
    expect(metrics.onboardingBlockers).toBe(1);
    expect(metrics.overdueCommitments).toBe(1);
    expect(metrics.health.atRisk).toBe(1);
    expect(metrics.exceptions.map((item) => item.title)).toEqual(expect.arrayContaining([
      "Unresolved client risk",
      "Required next action missing",
      "Onboarding blocked",
      "Overdue commitment",
    ]));
    expect(metrics.nextReview?.id).toBe("riley-hart");
  });

  it("uses report values when the authenticated API supplies them", () => {
    const metrics = dashboardMetrics({
      ...fixtureData,
      report: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-10-01T00:00:00Z",
        activeClients: 7,
        newApprovals: 4,
        closures: 1,
        calls: 10,
        referrals: 5,
        convertedReferrals: 2,
        dueTasks: 10,
        onTimeTasks: 8,
        taskCompletionRate: 0.8,
        stages: { new: 0, follow_up: 0, pending_signup: 0, active: 7, paused: 0, not_interested: 0, closed: 0 },
        health: { strong: 4, stable: 2, needs_attention: 1, at_risk: 0, unknown: 0 },
        activityByDay: {},
        stageMovement: {},
        averageDaysInStage: {},
        overdueFollowUps: 0,
        stalledRecords: 0,
        onboardingPending: 0,
        onboardingBlocked: 0,
        reviewsOverdue: 0,
        dataQualityIssues: 0,
        integrationWarnings: 0,
        retention: { activeAtStart: 7, retainedAtEnd: 7, rate: 1 },
        comparison: { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z", calls: 8, newApprovals: 2, closures: 1, referrals: 4 },
      },
    });

    expect(metrics.activeClients).toBe(7);
    expect(metrics.newApprovals).toBe(4);
    expect(metrics.newApprovalsDelta).toBe(2);
    expect(metrics.followUpCompletion).toBe(80);
    expect(metrics.health).toEqual({ strong: 4, stable: 2, needsAttention: 1, atRisk: 0 });
  });

  it("formats directional comparisons without fixture-specific copy", () => {
    expect(formatDelta(0)).toBe("Unchanged from prior period");
    expect(formatDelta(2)).toBe("2 more than prior period");
    expect(formatDelta(-1, "percentage points")).toBe("1 fewer percentage points");
  });
});

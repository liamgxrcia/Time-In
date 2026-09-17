import { describe, it, expect, vi } from "vitest";
import type { Snapshot, Person } from "@/contracts/crm";
import {
  today,
  health,
  recommendation,
  report,
  search,
  canonicalID,
} from "@/lib/server/queries";
import { parseCSV, previewImport } from "@/lib/server/import";
import { parseCommand, readJSON } from "@/lib/server/validation";
import { ApiError, errorResponse, logEvent } from "@/lib/server/errors";
const now = new Date("2026-09-16T16:00:00Z");
const id = "11111111-1111-4111-8111-111111111111";
function person(extra: Partial<Person> = {}): Person {
  return {
    id,
    source: "manual",
    name: "Avery Example",
    emails: ["avery@example.com"],
    phones: [],
    notes: "",
    tags: [],
    organizationId: null,
    consentNote: "",
    sourceNote: "",
    consentRecordedAt: null,
    consentRecordedBy: null,
    currentOnboardingCaseId: null,
    communicationRestricted: false,
    stage: "new",
    priority: "normal",
    nextAction: null,
    lastContactAt: null,
    stageEnteredAt: "2026-09-01T12:00:00Z",
    reason: null,
    revision: 0,
    archivedAt: null,
    mergedInto: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra,
  };
}
function db(people: Person[] = [person()]): Snapshot {
  return {
    people,
    organizations: [],
    onboarding: [],
    clients: [],
    activities: [],
    tasks: [],
    scripts: [],
    referrals: [],
    files: [],
    audit: [],
    relationships: [],
    integrations: [],
    imports: [],
    lifecycleHistory: [],
  };
}
describe("deterministic domain services", () => {
  it("ranks risk and overdue work with stable IDs and explanations", () => {
    const data = db([
      person({ stage: "active" }),
      person({
        id: "22222222-2222-4222-8222-222222222222",
        stage: "follow_up",
        nextAction: {
          ownerId: id,
          type: "call",
          dueAt: "2026-09-14T12:00:00Z",
        },
      }),
    ]);
    data.clients = [
      {
        id: "c",
        personId: id,
        revision: 0,
        approvedAt: now.toISOString(),
        reviewAt: null,
        risks: ["Unresolved expectations"],
        healthOverride: null,
      },
    ];
    const first = today(data, now, "America/New_York");
    expect(first).toEqual(
      today(
        { ...data, people: [...data.people].reverse() },
        now,
        "America/New_York",
      ),
    );
    expect(first[0].category).toBe("risk");
    expect(
      first.every((x) => x.reason && x.accessibleLabel && x.destination),
    ).toBe(true);
  });
  it("uses the requested timezone for due-today classification", () => {
    const data = db([
      person({
        nextAction: {
          ownerId: id,
          type: "call",
          dueAt: "2026-09-16T01:00:00Z",
        },
      }),
    ]);
    expect(
      today(data, now, "America/New_York").some(
        (x) => x.category === "overdue_follow_up",
      ),
    ).toBe(true);
    expect(
      today(data, now, "UTC").some((x) => x.category === "due_today"),
    ).toBe(true);
  });
  it("excludes terminal and archived records", () => {
    expect(
      today(
        db([
          person({ stage: "closed" }),
          person({ archivedAt: now.toISOString() }),
        ]),
        now,
      ),
    ).toEqual([]);
  });
  it("preserves calculated health separately from override and explains it", () => {
    const data = db([
      person({ stage: "active", lastContactAt: "2026-06-01T12:00:00Z" }),
    ]);
    data.clients = [
      {
        id: "c",
        personId: id,
        revision: 0,
        approvedAt: now.toISOString(),
        reviewAt: null,
        risks: [],
        healthOverride: { state: "stable", reason: "CEO review documented" },
      },
    ];
    const result = health(data, id, now);
    expect(result.calculated).toBe("at_risk");
    expect(result.state).toBe("stable");
    expect(result.explanation).toContain("CEO review documented");
  });
  it("recommendations respect communication restrictions and never mutate", () => {
    const data = db([person({ communicationRestricted: true })]);
    const before = structuredClone(data);
    expect(recommendation(data, id, now).action).toContain("consent");
    expect(data).toEqual(before);
  });
  it("search ranks exact matches and finds contact methods", () => {
    const data = db();
    expect(search(data, "Avery Example")[0].score).toBe(100);
    expect(search(data, "avery@example.com")[0].score).toBe(30);
  });
  it("resolves merged referral provenance and detects redirect cycles", () => {
    const second = "22222222-2222-4222-8222-222222222222";
    const data = db([person({ mergedInto: second }), person({ id: second })]);
    expect(canonicalID(data, id)).toBe(second);
    data.people[1].mergedInto = id;
    expect(() => canonicalID(data, id)).toThrow("changed");
  });
  it("reports half-open ranges, timezone grouping and empty denominator", () => {
    const data = db();
    data.activities = [
      {
        id: "a",
        personId: id,
        kind: "call",
        summary: "",
        outcome: null,
        scriptVersionId: null,
        createdAt: "2026-09-16T01:00:00Z",
      },
      {
        id: "b",
        personId: id,
        kind: "call",
        summary: "",
        outcome: null,
        scriptVersionId: null,
        createdAt: "2026-09-17T00:00:00Z",
      },
    ];
    const result = report(
      data,
      "2026-09-16T00:00:00Z",
      "2026-09-17T00:00:00Z",
      "America/New_York",
      now,
    );
    expect(result.calls).toBe(1);
    expect(result.activityByDay["2026-09-15"]).toBe(1);
    expect(result.taskCompletionRate).toBeNull();
  });
  it("reports on-time completion using due dates rather than current open workload", () => {
    const data = db();
    data.tasks = [
      {
        id: "t",
        personId: id,
        title: "Review",
        dueAt: "2026-09-16T15:00:00Z",
        priority: "normal",
        status: "completed",
        recurrence: null,
        completedAt: "2026-09-16T14:00:00Z",
        evidence: "Reviewed",
        revision: 1,
      },
      {
        id: "late",
        personId: id,
        title: "Follow-up",
        dueAt: "2026-09-16T15:00:00Z",
        priority: "normal",
        status: "open",
        recurrence: null,
        completedAt: null,
        evidence: null,
        revision: 0,
      },
    ];
    expect(
      report(data, "2026-09-16T00:00:00Z", "2026-09-17T00:00:00Z", "UTC", now)
        .taskCompletionRate,
    ).toBe(0.5);
  });
});
describe("import preview", () => {
  it("parses quoted newlines, escaped quotes, CRLF and BOM", () => {
    const table = parseCSV(
      '\uFEFFName,Email\r\n"Avery, ""Example""",a@example.com\r\n"Two\nLines",b@example.com',
    );
    expect(table.rows[0][0]).toBe('Avery, "Example"');
    expect(table.rows[1][0]).toBe("Two\nLines");
  });
  it.each([
    "",
    "Name,Name\nA,B",
    "Name,Email\nA",
    'Name\n"unclosed',
    'Name\n"closed"junk',
  ])("rejects malformed CSV %j", (value) =>
    expect(() => parseCSV(value)).toThrow(ApiError),
  );
  it("detects existing and within-file duplicates without writing", () => {
    const data = db();
    const before = structuredClone(data);
    const preview = previewImport(
      "Name,Email,Phone\nNew,AVERY@example.com,+1 (202) 555-0100\nNew,AVERY@example.com,+1 (202) 555-0100\n,invalid,3",
      { name: "Name", email: "Email", phone: "Phone" },
      data,
    );
    expect(preview.rows[0].duplicates[0].id).toBe(id);
    expect(preview.rows[1].duplicates.some((d) => d.id === "row:2")).toBe(true);
    expect(preview.rows[0].phone).toBe("+12025550100");
    expect(preview.rows[2].errors).toHaveLength(3);
    expect(data).toEqual(before);
  });
  it("processes 1,000 rows with indexed duplicate lookups", () => {
    const csv =
      "Name,Email\n" +
      Array.from(
        { length: 1000 },
        (_, i) => `Person ${i},person${i}@example.com`,
      ).join("\n");
    const start = performance.now();
    expect(
      previewImport(csv, { name: "Name", email: "Email" }, db([])).validCount,
    ).toBe(1000);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
describe("typed validation and privacy", () => {
  it("rejects missing revisions and unrecognized sensitive fields", () => {
    expect(() =>
      parseCommand({
        operationId: id,
        command: { type: "lifecycle.transition", id, stage: "active" },
      }),
    ).toThrow(ApiError);
    expect(() =>
      parseCommand({
        operationId: id,
        command: {
          type: "person.create",
          name: "Example",
          password: "not-allowed",
        },
      }),
    ).toThrow(ApiError);
  });
  it("rejects oversized JSON streams", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(100) }),
    });
    await expect(readJSON(request, 20)).rejects.toThrow(ApiError);
  });
  it("never exposes raw exceptions or private log fields", () => {
    const secret = "private-note-do-not-log";
    const failure = errorResponse(new Error(secret), id);
    expect(JSON.stringify(failure)).not.toContain(secret);
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logEvent("api.failure", id, "VALIDATION");
    expect(JSON.parse(spy.mock.calls[0][0])).toEqual({
      event: "api.failure",
      requestId: id,
      code: "VALIDATION",
    });
    spy.mockRestore();
  });
});
describe("stage movement, aging and retention reports", () => {
  it("derives retention from historical stage instead of current status alone", () => {
    const data = db([
      person({
        createdAt: "2026-09-01T00:00:00Z",
        stage: "closed",
        stageEnteredAt: "2026-09-15T00:00:00Z",
      }),
    ]);
    data.lifecycleHistory = [
      {
        id: "h1",
        personId: id,
        operationId: id,
        reason: null,
        nextAction: null,
        fromStage: "pending_signup",
        toStage: "active",
        createdAt: "2026-09-05T00:00:00Z",
      },
      {
        id: "h2",
        personId: id,
        operationId: id,
        reason: null,
        nextAction: null,
        fromStage: "active",
        toStage: "closed",
        createdAt: "2026-09-15T00:00:00Z",
      },
    ];
    const result = report(
      data,
      "2026-09-10T00:00:00Z",
      "2026-09-16T00:00:00Z",
      "UTC",
      now,
    );
    expect(result.retention).toEqual({
      activeAtStart: 1,
      retainedAtEnd: 0,
      rate: 0,
    });
    expect(result.stageMovement["active:closed"]).toBe(1);
    expect(result.averageDaysInStage.active).toBe(5);
    expect(result.averageDaysInStage.closed).toBe(1);
    expect(result.comparison.start).toBe("2026-09-04T00:00:00.000Z");
  });
});

describe("R1 command preconditions", () => {
  const parse = (command: unknown) =>
    parseCommand({ operationId: id, command });
  it.each([
    {
      type: "client.review",
      personId: id,
      reviewAt: now.toISOString(),
      risks: [],
    },
    {
      type: "notification.preferences",
      emailEnabled: true,
      webPushEnabled: false,
    },
    { type: "file.finalize", id },
    {
      type: "script.publish",
      scriptId: id,
      name: "Intro",
      stage: "new",
      content: "Hello",
      disclosures: "",
      changeNote: "Edit",
    },
    {
      type: "import.commit",
      rows: [
        {
          row: 2,
          name: "Example",
          email: "",
          phone: "",
          choice: "merge",
          targetId: id,
        },
      ],
    },
  ])("rejects missing revision/version for $type", (command) =>
    expect(() => parse(command)).toThrow(ApiError),
  );
  it("rejects duplicate import row identifiers before a transaction", () => {
    const row = {
      row: 2,
      name: "Example",
      email: "",
      phone: "",
      choice: "skip",
    };
    expect(() => parse({ type: "import.commit", rows: [row, row] })).toThrow(
      ApiError,
    );
  });
  it("rejects overlapping import mappings and malformed phone text", () => {
    expect(() =>
      previewImport("Name\nExample", { name: "Name", email: "Name" }, db([])),
    ).toThrow(ApiError);
    const result = previewImport(
      "Name,Phone\nExample,abc1234567",
      { name: "Name", phone: "Phone" },
      db([]),
    );
    expect(result.rows[0].errors).toContain("Phone format needs review");
  });
});

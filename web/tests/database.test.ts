import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { Client } from "pg";
import {
  snapshot,
  selectOnboarding,
  type UserDatabaseClient,
} from "@/lib/server/repository";
import { randomUUID } from "node:crypto";
const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString) {
  const target = new URL(connectionString);
  if (
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    target.pathname !== "/timein_test"
  ) {
    throw new Error(
      "Database tests require an isolated local database named timein_test.",
    );
  }
}
const suite = connectionString ? describe : describe.skip;
const ceo = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
suite(
  "PostgreSQL RLS and transactional services (real non-owner roles)",
  () => {
    let db: Client;
    async function asUser(
      id: string | null,
      body: (client: Client) => Promise<void>,
    ) {
      await db.query("begin");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          id ?? "",
        ]);
        await body(db);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    async function command(
      payload: Record<string, unknown>,
      operation = randomUUID(),
    ) {
      let result: {
        id: string;
        revision?: number;
        version?: number;
        scriptId?: string;
        nextTaskId?: string;
        importRows?: { row: number; action: string; personId: string | null }[];
      } = { id: "" };
      await asUser(ceo, async (c) => {
        result = (
          await c.query("select public.crm_command($1,$2::jsonb) result", [
            operation,
            JSON.stringify(payload),
          ])
        ).rows[0].result;
      });
      return result;
    }
    async function person(name = "Fictional Example") {
      return (await command({ type: "person.create", name })).id;
    }
    async function revision(id: string) {
      return Number(
        (await db.query("select revision from public.people where id=$1", [id]))
          .rows[0].revision,
      );
    }
    beforeAll(async () => {
      db = new Client({ connectionString });
      await db.connect();
      await db.query(
        "insert into auth.users(id,email) values($1,$2),($3,$4) on conflict(id) do nothing",
        [ceo, "ceo@example.test", other, "other@example.test"],
      );
      await db.query(
        "insert into private.ceo_access(user_id) values($1) on conflict(singleton) do update set user_id=excluded.user_id,enabled=true",
        [ceo],
      );
    });
    afterAll(async () => {
      await db.end();
    });
    beforeEach(async () => {
      await db.query("delete from private.rate_limits");
    });
    it("persists source and consent provenance with immutable audit and returned revisions", async () => {
      const operation = randomUUID();
      const p = await command(
        {
          type: "person.create",
          name: "Provenance",
          source: "referral",
          sourceNote: "Introduction at event",
          consentNote: "Permission to call",
          communicationRestricted: true,
        },
        operation,
      );
      expect(p.revision).toBe(0);
      const saved = (
        await db.query("select * from public.people where id=$1", [p.id])
      ).rows[0];
      expect(saved).toMatchObject({
        source: "referral",
        source_note: "Introduction at event",
        consent_note: "Permission to call",
        consent_recorded_by: ceo,
        communication_restricted: true,
      });
      expect(saved.consent_recorded_at).toBeTruthy();
      const updated = await command({
        type: "person.update",
        id: p.id,
        expectedRevision: 0,
        name: "Provenance",
        emails: [],
        phones: [],
        notes: "",
        consentNote: "Permission revoked",
        communicationRestricted: true,
      });
      expect(updated.revision).toBe(1);
      const audit = (
        await db.query(
          "select metadata from public.audit_events where target_id=$1 and action='person.update'",
          [p.id],
        )
      ).rows[0].metadata;
      expect(audit.before.consentNote).toBe("Permission to call");
      expect(audit.after.consentNote).toBe("Permission revoked");
      expect(audit.actorId).toBe(ceo);
      await expect(
        command({ type: "person.create", name: "Bad", source: "system" }),
      ).rejects.toThrow("VALIDATION");
      await expect(
        command({
          type: "person.create",
          name: "Bad",
          password: "do-not-store",
        }),
      ).rejects.toThrow("VALIDATION");
    });
    it("assigns next actions to CEO and rejects foreign owners without history changes", async () => {
      const id = await person("Owned next action");
      const op = randomUUID();
      const payload = {
        type: "lifecycle.transition",
        id,
        expectedRevision: 0,
        stage: "follow_up",
        nextAction: {
          type: "call",
          dueAt: "2099-01-01T00:00:00Z",
          ownerId: ceo,
        },
      };
      await expect(
        command({
          ...payload,
          nextAction: { ...payload.nextAction, ownerId: other },
        }),
      ).rejects.toThrow("FORBIDDEN");
      await command(payload, op);
      expect(
        (
          await db.query(
            "select next_action_owner_id from public.lead_profiles where person_id=$1",
            [id],
          )
        ).rows[0].next_action_owner_id,
      ).toBe(ceo);
      expect(
        (
          await db.query(
            "select operation_id from public.lifecycle_history where person_id=$1",
            [id],
          )
        ).rows,
      ).toEqual([{ operation_id: op }]);
      expect(
        (
          await db.query(
            "select count(*)::int n from public.audit_events where operation_id=$1",
            [op],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("keeps task state independent and creates only one recurring successor on retry", async () => {
      const id = await person("Commitment");
      const task = await command({
        type: "task.create",
        personId: id,
        title: "Weekly review",
        dueAt: "2099-01-01T00:00:00Z",
        recurrence: { unit: "week", interval: 1 },
      });
      expect(task.revision).toBe(0);
      await command({
        type: "task.snooze",
        id: task.id,
        expectedRevision: 0,
        dueAt: "2099-01-02T00:00:00Z",
      });
      await expect(
        command({
          type: "task.complete",
          id: task.id,
          expectedRevision: 0,
          evidence: "Stale",
        }),
      ).rejects.toThrow("CONFLICT");
      const op = randomUUID(),
        payload = {
          type: "task.complete",
          id: task.id,
          expectedRevision: 1,
          evidence: "Reviewed together",
        };
      const result = await command(payload, op);
      expect(await command(payload, op)).toEqual(result);
      expect(result.nextTaskId).toBeTruthy();
      expect(
        (
          await db.query("select status,due_at from public.tasks where id=$1", [
            result.nextTaskId,
          ])
        ).rows[0].due_at.toISOString(),
      ).toBe("2099-01-09T00:00:00.000Z");
      await command({
        type: "task.cancel",
        id: result.nextTaskId,
        expectedRevision: 0,
        reason: "No longer needed",
      });
      expect(
        (
          await db.query(
            "select stage from public.lead_profiles where person_id=$1",
            [id],
          )
        ).rows[0].stage,
      ).toBe("new");
    });
    it("selects a new case after rejection and rejects decisions after the person leaves onboarding", async () => {
      const { id, onboardingId } = await onboarding();
      await command({
        type: "onboarding.decide",
        id: onboardingId,
        expectedRevision: 0,
        approve: false,
        rationale: "Needs a fresh review",
      });
      const current = await command({
        type: "onboarding.start",
        personId: id,
        dueAt: "2099-01-01T00:00:00Z",
        templateId: randomUUID(),
        templateVersion: 2,
        items: [{ title: "Consent", required: true }],
      });
      await expect(
        command({
          type: "onboarding.start",
          personId: id,
          dueAt: "2099-01-01T00:00:00Z",
          templateId: randomUUID(),
          templateVersion: 2,
          items: [{ title: "Consent", required: true }],
        }),
      ).rejects.toThrow("INVALID_TRANSITION");
      await command({
        type: "lifecycle.transition",
        id,
        expectedRevision: await revision(id),
        stage: "closed",
        reason: "Stopped",
      });
      await expect(
        command({
          type: "onboarding.decide",
          id: current.id,
          expectedRevision: 0,
          approve: false,
          rationale: "Stale form",
        }),
      ).rejects.toThrow("INVALID_TRANSITION");
    });
    it("guards client review revisions and preserves referral attribution on approval", async () => {
      const { id, onboardingId } = await onboarding();
      const referrer = await person("Introducer");
      const ref = await command({
        type: "referral.create",
        referrerId: referrer,
        personId: id,
        sourceNote: "Explicit introduction",
      });
      await expect(
        command({
          type: "referral.create",
          referrerId: referrer,
          personId: id,
          sourceNote: "Duplicate",
        }),
      ).rejects.toThrow("DUPLICATE");
      const o = (
        await db.query("select * from public.onboarding_cases where id=$1", [
          onboardingId,
        ])
      ).rows[0];
      for (const [index, item] of [...o.items, ...o.blockers].entries())
        await command({
          type: "onboarding.item",
          id: onboardingId,
          expectedRevision: index,
          itemId: item.id,
        });
      await command({
        type: "onboarding.decide",
        id: onboardingId,
        expectedRevision: 2,
        approve: true,
        rationale: "Approved",
      });
      const payload = {
        type: "client.review",
        personId: id,
        expectedRevision: 0,
        reviewAt: "2099-02-01T00:00:00Z",
        risks: ["Review expectations"],
      };
      const result = await command(payload);
      expect(result.revision).toBe(1);
      await expect(command(payload)).rejects.toThrow("CONFLICT");
      expect(
        (
          await db.query(
            "select referrer_id,person_id from public.referrals where id=$1",
            [ref.id],
          )
        ).rows[0],
      ).toEqual({ referrer_id: referrer, person_id: id });
    });
    it("publishes immutable sequential script versions and rejects stale or renamed lineage", async () => {
      const payload = {
        type: "script.publish",
        name: "Follow up",
        stage: "follow_up",
        content: "May we follow up?",
        disclosures: "Permission",
        changeNote: "Initial",
      };
      const first = await command(payload);
      expect(first.version).toBe(1);
      const next = {
        ...payload,
        scriptId: first.scriptId,
        expectedVersion: 1,
        content: "Updated phrasing",
        changeNote: "Clearer",
      };
      await expect(command({ ...next, name: "Silent rename" })).rejects.toThrow(
        "VALIDATION",
      );
      expect((await command(next)).version).toBe(2);
      await expect(command(next)).rejects.toThrow("CONFLICT");
    });
    it("revalidates import deduplication and revisions at commit and never reuses rolled-back revisions", async () => {
      const id = await person("Import target");
      const row = {
        row: 2,
        name: "Import target",
        email: "import-review@example.test",
        phone: "",
        choice: "create",
      };
      await expect(
        command({ type: "import.commit", rows: [row] }),
      ).rejects.toThrow("DUPLICATE");
      await expect(
        command({
          type: "import.commit",
          rows: [{ ...row, choice: "merge", targetId: id }],
        }),
      ).rejects.toThrow("VALIDATION");
      const batch = await command({
        type: "import.commit",
        rows: [{ ...row, choice: "merge", targetId: id, expectedRevision: 0 }],
      });
      await command({ type: "import.rollback", id: batch.id });
      expect(await revision(id)).toBe(2);
      await expect(
        command({
          type: "person.update",
          id,
          expectedRevision: 0,
          name: "Stale",
          emails: [],
          phones: [],
          notes: "",
          consentNote: "",
        }),
      ).rejects.toThrow("CONFLICT");
      await expect(
        command({
          type: "import.commit",
          rows: [{ ...row, phone: "abc1234567", allowDuplicate: true }],
        }),
      ).rejects.toThrow("IMPORT_INVALID");
      const create = await command({
        type: "import.commit",
        rows: [
          { ...row, allowDuplicate: true },
          { ...row, row: 3, choice: "skip" },
        ],
      });
      expect(create.importRows).toEqual([
        { row: 2, action: "created", personId: expect.any(String) },
        { row: 3, action: "skipped", personId: null },
      ]);
      await command({ type: "import.rollback", id: create.id });
    });
    it("rolls back repeated merges atomically with monotonic surviving revisions", async () => {
      const id = await person("Repeated merge");
      const row = {
        name: "Repeated merge",
        email: "one@example.test",
        phone: "",
        choice: "merge",
        targetId: id,
      };
      const batch = await command({
        type: "import.commit",
        rows: [
          { ...row, row: 2, expectedRevision: 0 },
          { ...row, row: 3, email: "two@example.test", expectedRevision: 1 },
        ],
      });
      await command({ type: "import.rollback", id: batch.id });
      expect(await revision(id)).toBe(3);
      expect(
        (await db.query("select emails from public.people where id=$1", [id]))
          .rows[0].emails,
      ).toEqual([]);
    });
    it("persists notification consent with optimistic concurrency and idempotency", async () => {
      const payload = {
          type: "notification.preferences",
          expectedRevision: 0,
          emailEnabled: true,
          webPushEnabled: false,
        },
        op = randomUUID();
      const result = await command(payload, op);
      expect(result.revision).toBe(1);
      expect(await command(payload, op)).toEqual(result);
      await expect(command(payload)).rejects.toThrow("CONFLICT");
      expect(
        (
          await command({
            ...payload,
            expectedRevision: 1,
            emailEnabled: false,
          })
        ).revision,
      ).toBe(2);
    });
    it("finalizes only an owned registered file with exact storage metadata and audits once", async () => {
      const personId = await person("Agreement owner");
      const file = await command({
        type: "file.register",
        personId,
        displayName: "Agreement.pdf",
        mimeType: "application/pdf",
        size: 42,
      });
      expect(file.revision).toBe(0);
      const path = `${ceo}/${file.id}`;
      await db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('agreements',$1,$2)",
        [path, { size: 41, mimetype: "application/pdf" }],
      );
      const payload = {
          type: "file.finalize",
          id: file.id,
          expectedRevision: 0,
        },
        op = randomUUID();
      await expect(command(payload, op)).rejects.toThrow("FILE_ACCESS");
      await db.query("update storage.objects set metadata=$2 where name=$1", [
        path,
        { size: 42, mimetype: "application/pdf" },
      ]);
      expect((await command(payload, op)).revision).toBe(1);
      expect((await command(payload, op)).revision).toBe(1);
      expect(
        (
          await db.query(
            "select count(*)::int n from public.audit_events where operation_id=$1",
            [op],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("projects real persisted snapshot into the complete frontend contract and current case selector", async () => {
      const { id, onboardingId } = await onboarding();
      await command({
        type: "onboarding.decide",
        id: onboardingId,
        expectedRevision: 0,
        approve: false,
        rationale: "Restart review",
      });
      const pending = await command({
        type: "onboarding.start",
        personId: id,
        dueAt: "2099-01-01T00:00:00Z",
        templateId: randomUUID(),
        templateVersion: 2,
        items: [{ title: "Consent", required: true }],
      });
      await asUser(ceo, async (c) => {
        const client = {
          rpc: async () => ({
            data: (await c.query("select public.crm_snapshot() data")).rows[0]
              .data,
            error: null,
          }),
        } as unknown as UserDatabaseClient;
        const projected = await snapshot(client);
        const person = projected.people.find((p) => p.id === id)!;
        expect(person.currentOnboardingCaseId).toBe(pending.id);
        expect(person.nextAction?.ownerId).toBe(ceo);
        const selection = selectOnboarding(projected, id);
        expect(selection.current?.id).toBe(pending.id);
        expect(selection.history).toHaveLength(2);
        expect(
          selectOnboarding(
            { ...projected, onboarding: [...projected.onboarding].reverse() },
            id,
          ),
        ).toEqual(selection);
        expect(
          projected.audit.every((a) => a.actorId === ceo && a.operationId),
        ).toBe(true);
        expect(() => selectOnboarding(projected, randomUUID())).toThrow();
      });
    });
    it("independently exercises every public table policy as CEO and non-CEO", async () => {
      const tables = (
        await db.query(
          "select tablename from pg_tables where schemaname='public' order by tablename",
        )
      ).rows.map((r) => r.tablename as string);
      for (const table of tables) {
        if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name");
        const columns = table === "integration_connections"
          ? "id,owner_id,created_at,updated_at,revision,archived_at,provider,health,last_sync,error_category"
          : "*";
        await asUser(other, async (c) =>
          expect((await c.query(`select ${columns} from public.${table}`)).rows).toEqual(
            [],
          ),
        );
        await asUser(ceo, async (c) =>
          expect(
            (await c.query(`select ${columns} from public.${table}`)).rows.every(
              (row) => row.owner_id === ceo,
            ),
          ).toBe(true),
        );
      }
    });
    it("preserves lifecycle reasons and next-action provenance through reopening", async () => {
      const id = await person("Reopen audit");
      await command({
        type: "lifecycle.transition",
        id,
        expectedRevision: 0,
        stage: "closed",
        reason: "Requested closure",
      });
      await command({
        type: "lifecycle.transition",
        id,
        expectedRevision: 1,
        stage: "follow_up",
        nextAction: { type: "call", dueAt: "2099-01-01T00:00:00Z" },
      });
      const rows = (
        await db.query(
          "select to_stage,reason,next_action from public.lifecycle_history where person_id=$1",
          [id],
        )
      ).rows;
      expect(rows.find((r) => r.to_stage === "closed").reason).toBe(
        "Requested closure",
      );
      expect(
        rows.find((r) => r.to_stage === "follow_up").next_action.ownerId,
      ).toBe(ceo);
      await expect(
        db.query("delete from public.lifecycle_history where person_id=$1", [
          id,
        ]),
      ).rejects.toThrow("IMMUTABLE_HISTORY");
    });
    it("enables RLS on every public business table", async () => {
      const rows = (
        await db.query(
          "select relname,relrowsecurity,relforcerowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'",
        )
      ).rows;
      expect(rows.length).toBeGreaterThanOrEqual(17);
      expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
        true,
      );
    });
    it("denies anonymous RPC and direct table writes even for the CEO", async () => {
      await db.query("begin");
      await db.query("set local role anon");
      await expect(
        db.query("select public.crm_command($1,$2)", [
          randomUUID(),
          JSON.stringify({ type: "person.create", name: "No" }),
        ]),
      ).rejects.toThrow(/permission denied/);
      await db.query("rollback");
      await expect(
        asUser(ceo, async (c) => {
          await c.query(
            "insert into public.people(owner_id,name) values($1,'Bypass')",
            [ceo],
          );
        }),
      ).rejects.toThrow(/permission denied/);
    });
    it("denies stage-column bypass via direct SQL", async () => {
      const id = await person();
      await expect(
        asUser(ceo, async (c) => {
          await c.query(
            "update public.lead_profiles set stage='active' where person_id=$1",
            [id],
          );
        }),
      ).rejects.toThrow(/permission denied/);
    });
    it("rejects non-CEO and expired/missing identity", async () => {
      await expect(
        asUser(other, async (c) => {
          await c.query("select public.crm_command($1,$2)", [
            randomUUID(),
            JSON.stringify({ type: "person.create", name: "No" }),
          ]);
        }),
      ).rejects.toThrow("FORBIDDEN");
      await expect(
        asUser(null, async (c) => {
          await c.query("select public.crm_command($1,$2)", [
            randomUUID(),
            JSON.stringify({ type: "person.create", name: "No" }),
          ]);
        }),
      ).rejects.toThrow("UNAUTHENTICATED");
    });
    it("RLS independently hides other owners and rejects cross-owner references", async () => {
      const foreign = randomUUID();
      await db.query(
        "insert into public.people(id,owner_id,name) values($1,$2,$3)",
        [foreign, other, "Other owner"],
      );
      await asUser(ceo, async (c) => {
        expect(
          (await c.query("select id from public.people where id=$1", [foreign]))
            .rows,
        ).toHaveLength(0);
      });
      await asUser(other, async (c) => {
        expect(
          (await c.query("select id from public.people")).rows,
        ).toHaveLength(0);
      });
      await expect(
        command({
          type: "activity.create",
          personId: foreign,
          kind: "note",
          summary: "No",
        }),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("enforces Follow-Up next action and Pending Signup conversation transactionally", async () => {
      const id = await person();
      const before = (
        await db.query("select count(*) from public.audit_events")
      ).rows[0].count;
      await expect(
        command({
          type: "lifecycle.transition",
          id,
          expectedRevision: 0,
          stage: "follow_up",
        }),
      ).rejects.toThrow("MISSING_NEXT_ACTION");
      expect(
        (await db.query("select count(*) from public.audit_events")).rows[0]
          .count,
      ).toBe(before);
      await expect(
        command({
          type: "lifecycle.transition",
          id,
          expectedRevision: 0,
          stage: "pending_signup",
        }),
      ).rejects.toThrow("INVALID_TRANSITION");
      await command({
        type: "lifecycle.transition",
        id,
        expectedRevision: 0,
        stage: "follow_up",
        nextAction: { type: "call", dueAt: "2027-01-01T12:00:00Z" },
      });
      expect(
        (
          await db.query(
            "select stage from public.lead_profiles where person_id=$1",
            [id],
          )
        ).rows[0].stage,
      ).toBe("follow_up");
    });
    it("is idempotent and rejects operation-key reuse with a different payload", async () => {
      const operation = randomUUID();
      const payload = { type: "person.create", name: "Retry" };
      const first = await command(payload, operation);
      expect(await command(payload, operation)).toEqual(first);
      await expect(
        command({ ...payload, name: "Different" }, operation),
      ).rejects.toThrow("CONFLICT");
      expect(
        (
          await db.query(
            "select * from public.audit_events where operation_id=$1",
            [operation],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("serializes concurrent stale mutations so only one succeeds", async () => {
      const id = await person();
      const worker = async (name: string) => {
        const c = new Client({ connectionString });
        await c.connect();
        try {
          await c.query("begin");
          await c.query("set local role authenticated");
          await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
            ceo,
          ]);
          await c.query("select public.crm_command($1,$2)", [
            randomUUID(),
            JSON.stringify({
              type: "person.update",
              id,
              expectedRevision: 0,
              name,
              emails: [],
              phones: [],
              notes: "",
              consentNote: "",
            }),
          ]);
          await c.query("commit");
          return "saved";
        } catch {
          await c.query("rollback");
          return "conflict";
        } finally {
          await c.end();
        }
      };
      expect(
        (await Promise.all([worker("One"), worker("Two")])).sort(),
      ).toEqual(["conflict", "saved"]);
    });
    async function onboarding() {
      const id = await person();
      await command({
        type: "activity.create",
        personId: id,
        kind: "call",
        summary: "Interested",
        outcome: "interested",
        nextAction: { type: "onboarding", dueAt: "2027-01-01T12:00:00Z" },
      });
      const o = await command({
        type: "onboarding.start",
        personId: id,
        dueAt: "2027-01-01T12:00:00Z",
        templateId: randomUUID(),
        templateVersion: 1,
        items: [{ title: "Consent", required: true }],
        blockers: ["Agreement"],
      });
      return { id, onboardingId: o.id };
    }
    it("rejects incomplete approval, audits waivers, and approves atomically", async () => {
      const { id, onboardingId } = await onboarding();
      await expect(
        command({
          type: "onboarding.decide",
          id: onboardingId,
          expectedRevision: 0,
          approve: true,
          rationale: "Reviewed",
        }),
      ).rejects.toThrow("ONBOARDING_INCOMPLETE");
      const o = (
        await db.query("select * from public.onboarding_cases where id=$1", [
          onboardingId,
        ])
      ).rows[0];
      await command({
        type: "onboarding.item",
        id: onboardingId,
        expectedRevision: 0,
        itemId: o.items[0].id,
      });
      await command({
        type: "onboarding.item",
        id: onboardingId,
        expectedRevision: 1,
        itemId: o.blockers[0].id,
        waiverReason: "Documented exception",
      });
      await command({
        type: "onboarding.decide",
        id: onboardingId,
        expectedRevision: 2,
        approve: true,
        rationale: "Approved with explicit waiver",
      });
      expect(
        (
          await db.query(
            "select stage from public.lead_profiles where person_id=$1",
            [id],
          )
        ).rows[0].stage,
      ).toBe("active");
      expect(
        (
          await db.query(
            "select * from public.client_accounts where person_id=$1",
            [id],
          )
        ).rows,
      ).toHaveLength(1);
      await expect(
        db.query(
          "update public.onboarding_cases set decision='rejected' where id=$1",
          [onboardingId],
        ),
      ).rejects.toThrow("IMMUTABLE_HISTORY");
    });
    it("rejection never approves and reopening writes new lifecycle events", async () => {
      const { id, onboardingId } = await onboarding();
      await command({
        type: "onboarding.decide",
        id: onboardingId,
        expectedRevision: 0,
        approve: false,
        rationale: "Not suitable",
      });
      await expect(
        command({
          type: "lifecycle.transition",
          id,
          expectedRevision: await revision(id),
          stage: "active",
        }),
      ).rejects.toThrow("ONBOARDING_INCOMPLETE");
      await command({
        type: "lifecycle.transition",
        id,
        expectedRevision: await revision(id),
        stage: "closed",
        reason: "Declined",
      });
      await command({
        type: "lifecycle.transition",
        id,
        expectedRevision: await revision(id),
        stage: "new",
      });
      expect(
        (
          await db.query(
            "select * from public.lifecycle_history where person_id=$1",
            [id],
          )
        ).rows,
      ).toHaveLength(3);
    });
    it("preserves immutable scripts and audit history", async () => {
      const first = await command({
        type: "script.publish",
        name: "Introduction",
        stage: "new",
        content: "Ask permission.",
        disclosures: "Consent required.",
        changeNote: "First version",
      });
      const row = (
        await db.query("select * from public.script_versions where id=$1", [
          first.id,
        ])
      ).rows[0];
      await command({
        type: "script.publish",
        scriptId: row.script_id,
        expectedVersion: 1,
        name: "Introduction",
        stage: "new",
        content: "Updated wording.",
        disclosures: "Consent required.",
        changeNote: "Clearer",
      });
      expect(
        (
          await db.query(
            "select * from public.script_versions where script_id=$1",
            [row.script_id],
          )
        ).rows,
      ).toHaveLength(2);
      await expect(
        db.query(
          "update public.script_versions set content='Overwrite' where id=$1",
          [first.id],
        ),
      ).rejects.toThrow("IMMUTABLE_HISTORY");
      await expect(db.query("delete from public.audit_events")).rejects.toThrow(
        "IMMUTABLE_HISTORY",
      );
    });
    it("preserves referral attribution and timeline through merge", async () => {
      const source = await person("Duplicate"),
        target = await person("Canonical"),
        referred = await person("Referred");
      await command({
        type: "activity.create",
        personId: source,
        kind: "note",
        summary: "Prior history",
      });
      const referral = await command({
        type: "referral.create",
        referrerId: source,
        personId: referred,
        sourceNote: "Consent documented",
      });
      await command({
        type: "person.merge",
        sourceId: source,
        targetId: target,
        sourceRevision: await revision(source),
        expectedRevision: await revision(target),
      });
      expect(
        (
          await db.query("select merged_into from public.people where id=$1", [
            source,
          ])
        ).rows[0].merged_into,
      ).toBe(target);
      expect(
        (
          await db.query(
            "select referrer_id from public.referrals where id=$1",
            [referral.id],
          )
        ).rows[0].referrer_id,
      ).toBe(source);
      expect(
        (
          await db.query("select * from public.activities where person_id=$1", [
            source,
          ])
        ).rows,
      ).toHaveLength(1);
    });
    it("commits and rolls back imports, rejects changed records and partial invalid commits", async () => {
      const rows = [
        {
          row: 2,
          name: "Imported",
          email: "imported@example.com",
          phone: "",
          choice: "create",
        },
      ];
      const b = await command({ type: "import.commit", rows });
      const batch = (
        await db.query("select * from public.import_batches where id=$1", [
          b.id,
        ])
      ).rows[0];
      const id = batch.manifest[0].id;
      await command({ type: "import.rollback", id: b.id });
      expect(
        (await db.query("select * from public.people where id=$1", [id])).rows,
      ).toHaveLength(0);
      const c = await command({ type: "import.commit", rows });
      const changed = (
        await db.query(
          "select manifest from public.import_batches where id=$1",
          [c.id],
        )
      ).rows[0].manifest[0].id;
      await command({
        type: "activity.create",
        personId: changed,
        kind: "note",
        summary: "New work",
      });
      await expect(
        command({ type: "import.rollback", id: c.id }),
      ).rejects.toThrow("ROLLBACK_CONFLICT");
      const before = (await db.query("select count(*) from public.people"))
        .rows[0].count;
      await expect(
        command({
          type: "import.commit",
          rows: [
            { ...rows[0], allowDuplicate: true },
            { ...rows[0], row: 3, email: "bad" },
          ],
        }),
      ).rejects.toThrow("IMPORT_INVALID");
      expect(
        (await db.query("select count(*) from public.people")).rows[0].count,
      ).toBe(before);
    });
    it("rolls back explicit contact merge without erasing prior values", async () => {
      const target = await person("Existing");
      const batch = await command({
        type: "import.commit",
        rows: [
          {
            row: 2,
            name: "Imported Name",
            email: "new@example.com",
            phone: "",
            choice: "merge",
            targetId: target,
            expectedRevision: 0,
          },
        ],
      });
      expect(
        (
          await db.query("select emails from public.people where id=$1", [
            target,
          ])
        ).rows[0].emails,
      ).toContain("new@example.com");
      await command({ type: "import.rollback", id: batch.id });
      expect(
        (
          await db.query("select emails from public.people where id=$1", [
            target,
          ])
        ).rows[0].emails,
      ).toEqual([]);
    });
    it("enforces configured MFA in RLS and direct RPCs, not only HTTP", async () => {
      const factor = randomUUID();
      await db.query(
        "insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')",
        [factor, ceo],
      );
      try {
        await asUser(ceo, async (c) => {
          expect(
            (await c.query("select * from public.people")).rows,
          ).toHaveLength(0);
        });
        await expect(
          command({ type: "person.create", name: "MFA bypass" }),
        ).rejects.toThrow("FORBIDDEN");
        await asUser(ceo, async (c) => {
          await c.query("select set_config('request.jwt.claims',$1,true)", [
            JSON.stringify({ sub: ceo, aal: "aal2" }),
          ]);
          expect(
            (await c.query("select * from public.people")).rows.length,
          ).toBeGreaterThan(0);
        });
      } finally {
        await db.query("delete from auth.mfa_factors where id=$1", [factor]);
      }
    });
    it("returns a consistent owner-scoped snapshot and rejects non-CEO snapshots", async () => {
      await asUser(ceo, async (c) => {
        const result = (await c.query("select public.crm_snapshot() data"))
          .rows[0].data;
        expect(
          result.people.every((p: { owner_id: string }) => p.owner_id === ceo),
        ).toBe(true);
        expect(
          result.lead_profiles.every((l: { person_id: string }) =>
            result.people.some((p: { id: string }) => p.id === l.person_id),
          ),
        ).toBe(true);
      });
      await expect(
        asUser(other, async (c) => {
          await c.query("select public.crm_snapshot()");
        }),
      ).rejects.toThrow("FORBIDDEN");
    });
    it("denies private file bypass and forged completion", async () => {
      const id = await person();
      const f = await command({
        type: "file.register",
        personId: id,
        displayName: "Agreement.pdf",
        mimeType: "application/pdf",
        size: 12,
      });
      expect(
        (
          await db.query(
            "select public from storage.buckets where id='agreements'",
          )
        ).rows[0].public,
      ).toBe(false);
      await expect(
        command({ type: "file.finalize", id: f.id, expectedRevision: 0 }),
      ).rejects.toThrow("FILE_ACCESS");
      await asUser(ceo, async (c) => {
        expect(
          (await c.query("select * from storage.objects")).rows,
        ).toHaveLength(0);
      });
      await expect(
        asUser(ceo, async (c) => {
          await c.query(
            "insert into storage.objects(bucket_id,name) values('agreements','bypass')",
          );
        }),
      ).rejects.toThrow(/row-level security/);
      await db.query(
        'insert into storage.objects(bucket_id,name,metadata) select \'agreements\',storage_path,\'{"size":12,"mimetype":"application/pdf"}\'::jsonb from public.file_agreements where id=$1',
        [f.id],
      );
      await command({ type: "file.finalize", id: f.id, expectedRevision: 0 });
      expect(
        (
          await db.query(
            "select status from public.file_agreements where id=$1",
            [f.id],
          )
        ).rows[0].status,
      ).toBe("available");
    });
    it("rate limits privileged auth attempts without exposing limiter to users", async () => {
      const key = randomUUID();
      await db.query("begin");
      await db.query("set local role service_role");
      for (let n = 0; n < 10; n++)
        expect(
          (
            await db.query("select public.consume_auth_limit($1) allowed", [
              key,
            ])
          ).rows[0].allowed,
        ).toBe(true);
      expect(
        (await db.query("select public.consume_auth_limit($1) allowed", [key]))
          .rows[0].allowed,
      ).toBe(false);
      await db.query("commit");
      await expect(
        asUser(ceo, async (c) => {
          await c.query("select public.consume_auth_limit($1)", [key]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  },
);

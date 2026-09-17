import { describe, expect, it } from "vitest";
import { fixtureData } from "@/lib/fixtures";
import { stages } from "@/lib/domain";
describe("deterministic CEO fixtures", () => {
  it("covers lifecycle and the required Today exceptions", () => { expect(new Set(fixtureData.people.map((person) => person.stage))).toEqual(new Set(stages)); expect(fixtureData.queue.map((item) => item.category)).toEqual(expect.arrayContaining(["missing-action", "onboarding-blocker", "overdue-commitment", "referral", "risk"])); });
  it("keeps prohibited account and financial fields outside the contract", () => { const serialized = JSON.stringify(fixtureData).toLowerCase(); for (const field of ["password", "mfa secret", "wager", "bet slip", "bank account", "loan", "interest rate"]) expect(serialized).not.toContain(field); });
});

"use client";
import Link from "next/link";
import { useDashboard } from "@/hooks/use-dashboard";
import { DataBoundary } from "@/components/data-boundary";
import { PageHeader } from "@/components/page-header";
import { WorkflowForm, Field, inputClass, value } from "@/components/workflow-form";
import { formatDate } from "@/lib/utils";
export function OnboardingPage() {
  const query = useDashboard();
  return <DataBoundary {...query} onRetry={() => query.refetch()} isEmpty={false} empty={null}>{query.data && <>
    <PageHeader eyebrow="Onboarding" title="Blockers first. Decisions with evidence." description="Complete or explicitly waive each required item before approving. Decisions are saved with their rationale." />
    <div className="space-y-6">{query.data.people.filter(p => p.stage === "pending-signup").map(person => {
      const current = person.onboarding;
      return <section key={person.id} className="surface p-5 sm:p-7"><h2 className="display text-2xl"><Link href={`/people/${person.id}`}>{person.name}</Link></h2>
      {!current ? <WorkflowForm className="mt-4" label="Start onboarding" build={data => ({ type: "onboarding.start", personId: person.id, templateId: "c062575a-c806-461e-9e31-f3aebc2c8371", templateVersion: 1, dueAt: new Date(value(data,"dueAt")).toISOString(), items: [{ title: "Record consent and contact preferences", required: true }, { title: "Review agreement and service expectations", required: true }], blockers: value(data,"blocker") ? [value(data,"blocker")] : [] })}><p className="text-sm text-muted">R1 checklist: consent and contact preferences; agreement and service expectations.</p><Field label={`Onboarding due date for ${person.name}`}><input required type="datetime-local" name="dueAt" className={inputClass} /></Field><Field label="Additional blocker (optional)"><input name="blocker" maxLength={200} className={inputClass} /></Field></WorkflowForm> : <>
        <p className="mt-2 text-sm text-muted">Template v{current.templateVersion} · Due {formatDate(current.dueAt)} · {current.decision}</p>
        <ul className="mt-5 divide-y divide-border">{[...current.items,...current.blockers].map(item => <li key={item.id} className="py-4"><h3 className="font-semibold">{item.title} <span className="text-xs text-muted">{item.required ? "Required" : "Optional"}</span></h3>{item.completed || item.waiverReason ? <p className="mt-2 text-sm text-success">{item.waiverReason ? `Waived: ${item.waiverReason}` : "Completed"}</p> : current.decision === "pending" && <WorkflowForm className="mt-3" label="Save checklist item" build={data => ({ type: "onboarding.item", id: current.id, expectedRevision: current.revision ?? 0, itemId: item.id, ...(value(data,"action") === "waive" ? { waiverReason: value(data,"reason") || (() => { throw new Error("A waiver requires a written reason."); })() } : {}) })}><div className="grid gap-3 sm:grid-cols-2"><Field label={`Action for ${item.title}`}><select name="action" className={inputClass}><option value="complete">Complete</option><option value="waive">Waive with reason</option></select></Field><Field label={`Waiver reason for ${item.title}`}><input name="reason" className={inputClass} /></Field></div></WorkflowForm>}</li>)}</ul>
        {current.decision === "pending" && <WorkflowForm className="mt-6 border-t border-border pt-5" label="Record decision" build={data => ({ type: "onboarding.decide", id: current.id, expectedRevision: current.revision ?? 0, approve: value(data,"decision") === "approve", rationale: value(data,"rationale") })}><Field label={`Decision for ${person.name}`}><select name="decision" required className={inputClass}><option value="">Choose decision</option><option value="approve">Approve and activate client</option><option value="reject">Reject onboarding</option></select></Field><Field label="Decision rationale"><textarea name="rationale" required className={inputClass} /></Field></WorkflowForm>}
      </>}
      {query.data.snapshot?.onboarding.filter(o => o.personId === person.id && o.decision !== "pending").map(o => <p key={o.id} className="mt-4 text-sm text-muted">Prior decision: {o.decision} · {o.rationale}</p>)}
      </section>;
    })}</div>{!query.data.people.some(p => p.stage === "pending-signup") && <p className="surface p-6 text-muted">No pending signup records need onboarding.</p>}
  </>}</DataBoundary>;
}

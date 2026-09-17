"use client";
import { useState } from "react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DataBoundary } from "@/components/data-boundary";
import { PageHeader } from "@/components/page-header";
import { WorkflowForm, Field, inputClass, value } from "@/components/workflow-form";
import { stages, stageLabel } from "@/lib/domain";
import { stageToAPI } from "@/lib/api/client";
import { formatDate } from "@/lib/utils";
export function ScriptsPage() {
  const query = useDashboard(); const [family, setFamily] = useState(""); const [message, setMessage] = useState("");
  const latest = [...(query.data?.scripts ?? [])].filter(s => !query.data?.scripts.some(other => other.familyId === s.familyId && other.version > s.version));
  const selected = latest.find(s => s.familyId === family);
  return <DataBoundary {...query} onRetry={() => query.refetch()} isEmpty={false} empty={null}>{query.data && <>
    <PageHeader eyebrow="Scripts" title="Approved language, with history intact." description="Publish a new script or version. Existing published versions stay read-only." />
    <details className="surface mb-6 p-5"><summary className="cursor-pointer font-semibold">Publish script</summary><Field label="Script lineage"><select className={inputClass} value={family} onChange={e => setFamily(e.target.value)}><option value="">New script</option>{latest.map(s => <option key={s.familyId} value={s.familyId}>{s.name} · latest v{s.version}</option>)}</select></Field>
    <WorkflowForm key={family} className="mt-4" label="Publish version" reset={false} build={data => ({ type: "script.publish", ...(selected ? { scriptId: selected.familyId, expectedVersion: selected.version } : {}), name: selected?.name ?? value(data,"name"), stage: selected ? stageToAPI(selected.stage) : stageToAPI(value(data,"stage") as typeof stages[number]), content: value(data,"content"), disclosures: value(data,"disclosures"), changeNote: value(data,"changeNote") })}>
      {!selected && <div className="grid gap-4 sm:grid-cols-2"><Field label="Script name"><input name="name" required maxLength={200} className={inputClass} /></Field><Field label="Lifecycle stage"><select name="stage" className={inputClass}>{stages.map(s => <option key={s} value={s}>{stageLabel[s]}</option>)}</select></Field></div>}
      <Field label="Script content"><textarea name="content" required rows={5} defaultValue={selected?.content} className={inputClass} /></Field><Field label="Required disclosures"><textarea name="disclosures" defaultValue={selected?.disclosures} className={inputClass} /></Field><Field label="Change note"><input name="changeNote" required className={inputClass} /></Field>
    </WorkflowForm></details>
    {message && <p role="status" className="mb-4 text-sm">{message}</p>}<div className="grid gap-5 lg:grid-cols-2">{[...query.data.scripts].sort((a,b) => b.effectiveAt.localeCompare(a.effectiveAt) || b.version-a.version).map(script => <article key={script.id} className="surface p-6"><p className="eyebrow">{stageLabel[script.stage]} · Published</p><h2 className="display mt-2 text-2xl">{script.name} · v{script.version}</h2><p className="mt-2 text-xs text-muted">Effective {formatDate(script.effectiveAt)}</p><blockquote className="mt-5 whitespace-pre-wrap border-l-2 border-gold pl-4">{script.content}</blockquote><p className="mt-4 text-sm"><strong>Disclosures: </strong>{script.disclosures || "None recorded"}</p><p className="mt-3 text-xs text-muted">{script.changeNote}</p><button className="mt-4 rounded-lg border border-border px-3 py-2 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(script.content); setMessage(`Copied ${script.name} v${script.version}.`); } catch { setMessage("Clipboard access was denied. Select the script text to copy it."); } }}>Copy script</button></article>)}</div>
  </>}</DataBoundary>;
}

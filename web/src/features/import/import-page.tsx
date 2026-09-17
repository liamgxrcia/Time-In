"use client";
import { useState } from "react";
import type { Command, ImportPreview, ImportResultRow } from "@/contracts/crm";
import { api } from "@/lib/api/client";
import { readImportFile } from "@/lib/import/file";
import { useDashboard } from "@/hooks/use-dashboard";
import { useCommand } from "@/hooks/use-command";
import { DataBoundary } from "@/components/data-boundary";
import { PageHeader } from "@/components/page-header";
import { WorkflowForm, Field, inputClass, MutationStatus } from "@/components/workflow-form";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
type Choice = { choice: "" | "skip" | "create" | "create_duplicate" | "merge"; targetId?: string };
export function ImportPage() {
  const query = useDashboard(); const action = useCommand();
  const [source,setSource] = useState<{ csv: string; headers: string[]; name: string } | null>(null);
  const [mapping,setMapping] = useState({ name:"",email:"",phone:"" });
  const [preview,setPreview] = useState<ImportPreview | null>(null); const [choices,setChoices] = useState<Record<number,Choice>>({});
  const [error,setError] = useState<Error | null>(null); const [busy,setBusy] = useState(false); const [result,setResult] = useState<ImportResultRow[] | null>(null);
  async function review() {
    if (!source) return; setBusy(true); setError(null); setPreview(null); setResult(null);
    try {
      const payload={ csv:source.csv,mapping:{ name:mapping.name,...(mapping.email ? { email:mapping.email } : {}),...(mapping.phone ? { phone:mapping.phone } : {}) } };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 1_048_576) throw new Error("Decoded CSV and mapping exceed the 1 MiB API limit. Split the file.");
      setPreview(await api.previewImport(payload.csv,payload.mapping)); setChoices({});
    } catch (e) { setError(e instanceof Error ? e : new Error("Preview failed.")); } finally { setBusy(false); }
  }
  async function commit() {
    if (!preview) return; setError(null);
    try {
      const revisions = new Map(query.data?.snapshot?.people.map(p => [p.id,p.revision]));
      const rows: Extract<Command,{type:"import.commit"}>["rows"] = preview.rows.map(row => {
        const selection=choices[row.row];
        if (!selection?.choice) throw new Error(`Choose a resolution for row ${row.row}.`);
        const base={ row:row.row,name:row.name,email:row.email,phone:row.phone };
        if (selection.choice === "skip") return { ...base,choice:"skip" };
        if (row.errors.length) throw new Error(`Correct the source file or skip invalid row ${row.row}.`);
        if (selection.choice === "merge") {
          const targetId=selection.targetId, expectedRevision=targetId ? revisions.get(targetId) : undefined;
          if (!targetId || expectedRevision === undefined) throw new Error(`Choose an existing merge target for row ${row.row}.`);
          revisions.set(targetId,expectedRevision+1);
          return { ...base,choice:"merge",targetId,expectedRevision };
        }
        return { ...base,choice:"create",...(selection.choice === "create_duplicate" ? { allowDuplicate:true } : {}) };
      });
      const saved=await action.run({ type:"import.commit",rows });
      if (saved) { setResult(saved.importRows ?? []); setPreview(null); }
    } catch (e) { setError(e instanceof Error ? e : new Error("Commit failed.")); }
  }
  return <DataBoundary {...query} onRetry={() => query.refetch()} isEmpty={false} empty={null}>{query.data && <>
    <PageHeader eyebrow="Import" title="Preview every change before it lands." description="Select a CSV, map its columns, resolve every row, then explicitly commit. Preview does not change CRM records." />
    <section className="surface space-y-5 p-5 sm:p-7"><Field label="CSV file"><input type="file" accept=".csv,text/csv" disabled={busy || action.busy} className={inputClass} onChange={async e => { const file=e.target.files?.[0]; if (!file) return; setBusy(true);setError(null);setPreview(null);setResult(null);setSource(null); try { const parsed=await readImportFile(file);setSource({...parsed,name:file.name});setMapping({name:parsed.headers[0] ?? "",email:"",phone:""}); } catch (e) { setError(e instanceof Error ? e : new Error("Cannot read file.")); } finally {setBusy(false);} }} /></Field>
    <p className="text-xs text-muted">At most 1 MiB including decoded JSON request and 1,000 rows. UTF-8 or BOM-marked UTF-16.</p>
    {source && <><p className="text-sm">Selected: {source.name}</p><div className="grid gap-4 sm:grid-cols-3">{(["name","email","phone"] as const).map(field => <Field key={field} label={`Map ${field}`}><select value={mapping[field]} disabled={action.busy} className={inputClass} onChange={e => {setMapping({...mapping,[field]:e.target.value});setPreview(null);}}><option value="">{field === "name" ? "Required: select column" : "Do not import"}</option>{source.headers.map(header => <option key={header}>{header}</option>)}</select></Field>)}</div><Button disabled={busy || action.busy || !mapping.name} onClick={() => void review()}>{busy ? "Validating…" : "Preview mapped rows"}</Button></>}
    {preview && <><p role="status" className="text-sm">Preview only: {preview.validCount} valid rows; {preview.duplicateCount} rows with possible duplicates. Choose a resolution for every row.</p><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr><th>Row</th><th>Mapped contact</th><th>Validation and matches</th><th>Resolution</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.row} className="border-t border-border"><td className="p-2">{row.row}</td><td className="p-2">{row.name || "Name missing"}<p className="text-xs text-muted">{row.email} {row.phone}</p></td><td className="p-2"><p className="text-danger">{row.errors.join("; ")}</p>{row.duplicates.map(d => <p key={d.id} className="text-xs">{query.data.people.find(p => p.id === d.id)?.name ?? d.id}: {d.reasons.join(", ")}</p>)}{!row.errors.length && !row.duplicates.length && "Valid"}</td><td className="p-2"><select aria-label={`Resolution for row ${row.row}`} disabled={action.busy} className={inputClass} value={choices[row.row]?.choice ?? ""} onChange={e => setChoices({...choices,[row.row]:{choice:e.target.value as Choice["choice"]}})}><option value="">Choose resolution</option><option value="skip">Skip</option>{!row.errors.length && <><option value={row.duplicates.length ? "create_duplicate" : "create"}>{row.duplicates.length ? "Create separately (reviewed duplicate)" : "Create person"}</option><option value="merge">Merge into existing person</option></>}</select>{choices[row.row]?.choice === "merge" && <select aria-label={`Merge target for row ${row.row}`} required className={inputClass} value={choices[row.row]?.targetId ?? ""} onChange={e => setChoices({...choices,[row.row]:{choice:"merge",targetId:e.target.value}})}><option value="">Choose existing person</option>{query.data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</td></tr>)}</tbody></table></div><Button disabled={action.busy || !preview.rows.length || preview.rows.some(r => !choices[r.row]?.choice)} onClick={() => void commit()}>{action.busy ? "Committing…" : "Commit reviewed import"}</Button></>}
    <MutationStatus error={error ?? action.error} saved={action.saved} />{result && <ResultRows rows={result} />}
    </section>
    <h2 className="display mb-4 mt-8 text-2xl">Saved import batches</h2><div className="space-y-4">{query.data.snapshot?.imports.map(batch => <section key={batch.id} className="surface p-5"><h3 className="font-semibold">Batch {batch.id.slice(0,8)} · {batch.status.replaceAll("_"," ")}</h3><p className="my-3 text-xs text-muted">{formatDate(batch.createdAt,true)} · {batch.rowCount} created/merged rows</p><ResultRows rows={batch.results} />{batch.status === "committed" && <WorkflowForm className="mt-4" label="Roll back batch" build={() => ({type:"import.rollback",id:batch.id})}><label className="flex gap-2 text-sm"><input required type="checkbox" />I understand this restores only unchanged imported records; conflicts must be reviewed.</label></WorkflowForm>}</section>)}</div>
  </>}</DataBoundary>;
}
function ResultRows({rows}:{rows:ImportResultRow[]}) { return <ul aria-label="Import results" className="mt-4 space-y-2 text-sm">{rows.map(row => <li key={row.row}>Row {row.row}: {row.action}{row.personId && <> · <a className="underline" href={`/people/${row.personId}`}>Open person</a></>}</li>)}</ul>; }

"use client";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WorkflowForm, Field, inputClass, value } from "@/components/workflow-form";
export function NewPersonPage() {
  const router = useRouter();
  return <><PageHeader eyebrow="New relationship" title="Start with what you know." description="Save contact details, source and consent to the private command center." />
    <WorkflowForm className="surface max-w-3xl p-6" label="Create person" onSaved={result => router.push(`/people/${result.id}`)} build={data => ({ type: "person.create", name: value(data,"name"), emails: value(data,"email") ? [value(data,"email")] : [], phones: value(data,"phone") ? [value(data,"phone")] : [], source: value(data,"source") as "manual" | "referral" | "imported", sourceNote: value(data,"sourceNote"), consentNote: value(data,"consentNote"), communicationRestricted: data.has("restricted") })}>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Full name"><input name="name" required maxLength={200} className={inputClass} /></Field><Field label="Source"><select name="source" className={inputClass}><option value="manual">Manual</option><option value="referral">Referral</option><option value="imported">Imported</option></select></Field><Field label="Email"><input name="email" type="email" className={inputClass} /></Field><Field label="Phone"><input name="phone" type="tel" maxLength={40} className={inputClass} /></Field></div>
      <Field label="Source note"><textarea name="sourceNote" maxLength={10000} className={inputClass} /></Field><Field label="Consent note"><textarea name="consentNote" maxLength={10000} className={inputClass} /></Field><label className="flex gap-2 text-sm"><input type="checkbox" name="restricted" />Restrict communications pending consent review</label>
    </WorkflowForm></>;
}

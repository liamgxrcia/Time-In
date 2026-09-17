"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCommand } from "@/hooks/use-command";
import { PhoneCall, X } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DataBoundary } from "@/components/data-boundary";
import { EmptyState } from "@/components/empty-state";
import { PersonSummary } from "./person-summary";
import { Button } from "@/components/ui/button";



const callSchema = z.object({ summary: z.string().trim().min(3, "Add a short summary."), outcome: z.enum(["no-answer", "follow-up", "interested", "not-interested", "completed"]), nextActionType: z.enum(["call", "message", "meeting", "review", "onboarding"]), dueAt: z.string().min(1, "Choose a next-action date.") });
type CallValues = z.infer<typeof callSchema>;

export function PersonPage() {
  const { id } = useParams<{ id: string }>(); const query = useDashboard(); const [dialog, setDialog] = useState(false);
  const person = query.data?.people.find((candidate) => candidate.id === id);
  const mutation = useCommand();
  async function logCall(values: CallValues) {
    if (!person) return;
    const result = await mutation.run({ type: "activity.create", personId: person.id, kind: "call", summary: values.summary, outcome: values.outcome.replaceAll("-", "_") as "no_answer" | "follow_up" | "interested" | "not_interested" | "completed", nextAction: { type: values.nextActionType, dueAt: new Date(values.dueAt).toISOString() } });
    if (result) setDialog(false);
  }

  return <DataBoundary isLoading={query.isLoading} isFetching={query.isFetching} error={query.error} onRetry={() => query.refetch()} isEmpty={Boolean(query.data && !person)} empty={<EmptyState title="Record not found" message="This person may have been archived or merged into another record." />}>
    {query.data && person && <><div className="mb-5 flex justify-end"><Button onClick={() => setDialog(true)}><PhoneCall className="size-4" />Log a call</Button></div><PersonSummary person={person} data={query.data} showOpen={false} /><CallDialog open={dialog} onOpenChange={setDialog} onSubmit={(values) => void logCall(values)} pending={mutation.busy} serverError={mutation.error?.message} /></>}
  </DataBoundary>;
}

function CallDialog({ open, onOpenChange, onSubmit, pending, serverError }: { open: boolean; onOpenChange: (value: boolean) => void; onSubmit: (values: CallValues) => void; pending: boolean; serverError?: string }) {
  const { register, handleSubmit, formState: { errors } } = useForm<CallValues>({ resolver: zodResolver(callSchema), defaultValues: { outcome: "follow-up", nextActionType: "call" } });
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-ink/60" /><Dialog.Content className="fixed inset-x-3 bottom-3 z-50 max-h-[90vh] overflow-y-auto rounded-2xl bg-paper p-6 shadow-2xl sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2"><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="display text-3xl">Capture the conversation</Dialog.Title><Dialog.Description className="mt-2 text-sm text-muted">Record the outcome and keep a clear next action.</Dialog.Description></div><Dialog.Close className="rounded-lg p-2 hover:bg-ink/5" aria-label="Close"><X className="size-5" /></Dialog.Close></div><form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit)}><Field label="Conversation summary" error={errors.summary?.message}><textarea {...register("summary")} rows={4} className="w-full rounded-lg border border-border bg-white px-3 py-2" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Outcome" error={errors.outcome?.message}><select {...register("outcome")} className="w-full rounded-lg border border-border bg-white px-3 py-2"><option value="follow-up">Follow up</option><option value="interested">Interested</option><option value="no-answer">No answer</option><option value="completed">Conversation completed</option><option value="not-interested">Not interested</option></select></Field><Field label="Next action" error={errors.nextActionType?.message}><select {...register("nextActionType")} className="w-full rounded-lg border border-border bg-white px-3 py-2"><option value="call">Call</option><option value="message">Message</option><option value="meeting">Meeting</option><option value="review">Review</option><option value="onboarding">Onboarding</option></select></Field></div><Field label="Next-action date and time" error={errors.dueAt?.message}><input type="datetime-local" {...register("dueAt")} className="w-full rounded-lg border border-border bg-white px-3 py-2" /></Field>{serverError && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{serverError}</p>}<div className="flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="secondary">Cancel</Button></Dialog.Close><Button disabled={pending}>{pending ? "Saving…" : "Log call and next action"}</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-semibold">{label}<span className="mt-2 block font-normal">{children}</span>{error && <span className="mt-1 block text-xs text-danger">{error}</span>}</label>; }

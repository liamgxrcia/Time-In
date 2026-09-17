"use client";
import { useState, type ReactNode } from "react";
import type { Command, CommandResult } from "@/contracts/crm";
import { useCommand } from "@/hooks/use-command";
import { ApiError } from "@/lib/api/client";
import { Button } from "./ui/button";
export const inputClass = "mt-1 block w-full min-w-0 rounded-lg border border-border bg-paper px-3 py-2 text-sm font-normal";
export const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 text-sm font-semibold">{label}{children}</label>;
}
export function MutationStatus({ error, saved }: { error: Error | null; saved: boolean }) {
  return <>{error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error.message}{error instanceof ApiError && ["CONFLICT", "ROLLBACK_CONFLICT"].includes(error.code) && " Latest records have been reloaded. Review them before submitting again."}{error instanceof ApiError && error.status === 401 && <> <a className="underline" href="/login">Sign in again</a>.</>}</p>}{saved && <p role="status" className="text-sm text-success">Saved to the server.</p>}</>;
}
export function WorkflowForm({ children, label, build, onSaved, className = "", reset = true }: { children: ReactNode; label: string; build: (data: FormData) => Command; onSaved?: (result: CommandResult) => void; className?: string; reset?: boolean }) {
  const action = useCommand(); const [localError, setLocalError] = useState<Error | null>(null);
  return <form className={`space-y-4 ${className}`} onSubmit={async event => {
    event.preventDefault(); const form = event.currentTarget; setLocalError(null);
    try { const result = await action.run(build(new FormData(form))); if (result) { if (reset) form.reset(); onSaved?.(result); } }
    catch (error) { setLocalError(error instanceof Error ? error : new Error("Review the form.")); }
  }}><fieldset disabled={action.busy} className="min-w-0 space-y-4">{children}<Button type="submit" disabled={action.busy}>{action.busy ? "Saving…" : label}</Button></fieldset><MutationStatus error={localError ?? action.error} saved={action.saved} /></form>;
}

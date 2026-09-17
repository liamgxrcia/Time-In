"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { fixtureMode } from "@/lib/demo-mode";
import { DataBoundary } from "@/components/data-boundary";
import { PageHeader } from "@/components/page-header";
import { WorkflowForm } from "@/components/workflow-form";
import { Button } from "@/components/ui/button";
import { GoogleCalendarCard } from "./google-calendar-card";
export function SettingsPage() {
  const router = useRouter(); const [error, setError] = useState(""); const [busy,setBusy] = useState(false);
  const query = useQuery({ queryKey: ["crm","settings"], queryFn: async () => { const [preferences,system] = await Promise.all([api.preferences(),api.system()]); return { preferences,system }; }, enabled: !fixtureMode });
  if (fixtureMode) return <><PageHeader eyebrow="Settings" title="Privacy and control, plainly stated." description="Manage saved notification consent, calendar access, and the current authenticated session." /><GoogleCalendarCard backendReady={false} /><p className="surface p-6">Connect the secure backend to manage preferences and sessions.</p></>;
  return <DataBoundary {...query} onRetry={() => query.refetch()} isEmpty={false} empty={null}>{query.data && <>
    <PageHeader eyebrow="Settings" title="Privacy and control, plainly stated." description="Manage saved notification consent, calendar access, and the current authenticated session." />
    <GoogleCalendarCard backendReady />
    <div className="grid gap-6 lg:grid-cols-2"><section className="surface p-6"><h2 className="display mb-4 text-2xl">Notification preferences</h2><p className="mb-4 text-sm text-muted">These preferences record your permission. Email and web push delivery are not available yet.</p><WorkflowForm key={query.data.preferences.revision} label="Save preferences" build={data => ({ type: "notification.preferences", expectedRevision: query.data.preferences.revision, emailEnabled: data.has("email"), webPushEnabled: data.has("push") })} reset={false}><label className="flex gap-2 text-sm"><input type="checkbox" name="email" defaultChecked={query.data.preferences.emailEnabled} />Allow email reminders when implemented</label><label className="flex gap-2 text-sm"><input type="checkbox" name="push" defaultChecked={query.data.preferences.webPushEnabled} />Allow web push reminders when implemented</label></WorkflowForm></section>
    <section className="surface p-6"><h2 className="display text-2xl">Current session</h2><p className="my-4 text-sm text-muted">Authentication and configured MFA are enforced by Supabase. Session expiry follows the deployed identity-provider policy.</p><Button disabled={busy} variant="secondary" onClick={async () => { setBusy(true); setError(""); try { await api.logout(); router.replace("/login"); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Sign-out failed."); } finally { setBusy(false); } }}>{busy ? "Signing out…" : "Sign out"}</Button>{error && <p role="alert" className="mt-3 text-danger">{error}</p>}</section>
    <section className="surface p-6"><h2 className="display text-2xl">System capabilities</h2><dl className="mt-4 space-y-3 text-sm"><div>Environment: {query.data.system.environment}</div><div>Database: {query.data.system.database}</div><div>Access: {query.data.system.cloudSync.replaceAll("_"," ")}</div><div>Notifications: {query.data.system.notifications.replaceAll("_"," ")}</div><div>Offline capture: {query.data.system.offlineCapture.replaceAll("_"," ")}</div></dl></section><section className="surface p-6"><h2 className="display text-2xl">Privacy</h2><p className="mt-4 text-sm leading-6 text-muted">This application stores relationship context and business history. Do not enter third-party credentials, MFA secrets, wagering instructions or fund-movement data.</p><a className="mt-4 inline-block text-sm underline" href="/operations">Review audit history</a></section></div>
  </>}</DataBoundary>;
}

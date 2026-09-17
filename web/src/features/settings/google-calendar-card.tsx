"use client";

import { useEffect, useState } from "react";
import { useCallback } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = {
  connected: boolean;
  health: "disconnected" | "healthy" | "warning";
  accountEmail: string | null;
  lastSync: string | null;
};
type CalendarEvent = { id: string; summary: string; start: string; end: string; htmlLink: string | null };

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const envelope = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !envelope?.data || envelope.error) throw new Error(envelope?.error?.message ?? "Calendar connection needs attention.");
  return envelope.data;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function initialGoogleResult() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("google") ?? "";
}

export function GoogleCalendarCard({ backendReady }: { backendReady: boolean }) {
  const [googleResult] = useState(initialGoogleResult);
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(backendReady);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => googleResult === "error" ? "Google Calendar connection was not completed." : "");
  const [message, setMessage] = useState(() => {
    return googleResult === "connected" ? "Google Calendar is connected." : googleResult === "disconnected" ? "Google Calendar has been disconnected." : "";
  });

  const load = useCallback(async () => {
    if (!backendReady) return;
    setLoading(true);
    setError("");
    try {
      const next = await read<Status>("/api/integrations/google/status");
      setStatus(next);
      if (next.connected) {
        const calendar = await read<{ connected: boolean; events: CalendarEvent[] }>("/api/integrations/google/events");
        setEvents(calendar.events);
      } else setEvents([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Calendar connection needs attention.");
    } finally {
      setLoading(false);
    }
  }, [backendReady]);

  useEffect(() => {
    if (!backendReady) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [backendReady, load]);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/google/disconnect", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Calendar connection could not be disconnected.");
      setStatus({ connected: false, health: "disconnected", accountEmail: null, lastSync: null });
      setEvents([]);
      setMessage("Google Calendar has been disconnected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Calendar connection could not be disconnected.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="surface p-6" aria-labelledby="google-calendar-heading">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="eyebrow">Calendar access</p>
        <h2 id="google-calendar-heading" className="display mt-2 text-2xl">Google Calendar</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Connect one Google account to view upcoming events inside BonusHub. Calendar access is read-only and can be revoked here at any time.</p>
      </div>
      <CalendarDays className="size-6 shrink-0 text-gold-strong" aria-hidden />
    </div>
    {!backendReady ? <p className="mt-5 rounded-lg border border-border bg-ivory p-4 text-sm text-muted">Connect the secure backend before linking Google Calendar.</p> : loading ? <p className="mt-5 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" aria-hidden />Checking calendar connection…</p> : status?.connected ? <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/5 p-4 text-sm"><span className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-success" aria-hidden />Connected as {status.accountEmail ?? "Google account"}</span>{status.lastSync && <span className="text-xs text-muted">Updated {displayDate(status.lastSync)}</span>}</div>
      <div className="mt-5 flex flex-wrap gap-2"><a href="https://calendar.google.com/" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-ivory">Open Google Calendar <ExternalLink className="size-4" aria-hidden /></a><Button variant="secondary" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden />Refresh events</Button><Button variant="secondary" disabled={busy} onClick={() => void disconnect()}><Unplug className="size-4" aria-hidden />{busy ? "Disconnecting…" : "Disconnect"}</Button></div>
      <div className="mt-6"><h3 className="text-sm font-bold uppercase tracking-[.14em]">Upcoming events</h3>{events.length ? <ul className="mt-3 divide-y divide-border rounded-lg border border-border">{events.map((event) => <li key={event.id} className="p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold">{event.summary}</p><p className="mt-1 text-sm text-muted">{displayDate(event.start)} – {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(event.end))}</p></div>{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" aria-label={`Open ${event.summary} in Google Calendar`}><ExternalLink className="size-4" aria-hidden /></a>}</div></li>)}</ul> : <p className="mt-3 text-sm text-muted">No upcoming events were returned.</p>}</div>
    </> : <div className="mt-5"><Link href="/api/integrations/google/start" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-ivory">Connect Google Calendar <CalendarDays className="size-4" aria-hidden /></Link><p className="mt-3 text-xs leading-5 text-muted">BonusHub requests read-only calendar access. Google handles the password and consent screen.</p></div>}
    {message && <p role="status" className="mt-4 text-sm text-success">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  </section>;
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DataBoundary } from "@/components/data-boundary";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { StageBadge } from "@/components/ui/badge";
import { PersonSummary } from "./person-summary";
import type { Person } from "@/lib/domain";

export function PeopleWorkspace({ mode }: { mode: "outreach" | "clients" | "search" }) {
  const query = useDashboard(); const [selectedId, setSelectedId] = useState<string>(); const [search, setSearch] = useState("");
  const people = useMemo(() => (query.data?.people ?? []).filter((person) => {
    const inMode = mode === "clients" ? ["active", "paused"].includes(person.stage) : mode === "outreach" ? ["new", "follow-up", "pending-signup"].includes(person.stage) : true;
    return inMode && `${person.name} ${person.email ?? ""} ${person.organization ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }), [query.data, mode, search]);
  const selected = people.find((person) => person.id === selectedId) ?? people[0];
  const title = mode === "clients" ? "Relationship continuity at a glance." : mode === "outreach" ? "Every conversation has a next step." : "Find any relationship or record.";
  const description = mode === "clients" ? "Active and paused relationships, with health, commitments, reviews, and risks kept in context." : mode === "outreach" ? "Prospects, follow-ups, and onboarding work in one focused list." : "Search permitted people, contact details, lifecycle stages, notes, and organizations.";
  return <DataBoundary isLoading={query.isLoading} isFetching={query.isFetching} error={query.error} onRetry={() => query.refetch()} isEmpty={Boolean(query.data && people.length === 0 && !search)} empty={<EmptyState title={mode === "clients" ? "No active clients yet" : "No outreach records yet"} message="Create a person or import approved source data to begin." />}>
    {query.data && <><PageHeader eyebrow={mode === "clients" ? "Client management" : mode === "outreach" ? "Outreach" : "Global search"} title={title} description={description} /><label className="surface mb-5 flex min-h-12 items-center gap-3 px-4"><Search className="size-5 text-muted" aria-hidden /><span className="sr-only">Search {mode}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email, or organization" className="w-full bg-transparent text-sm outline-none" /></label>
      {people.length === 0 ? <EmptyState title="No matching records" message="Check the spelling or try a broader search." /> : <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"><section className="surface overflow-hidden" aria-label={`${mode} records`}><div className="max-h-[calc(100vh-14rem)] divide-y divide-border overflow-y-auto">{people.map((person) => <PersonRow key={person.id} person={person} active={person.id === selected.id} onSelect={() => setSelectedId(person.id)} />)}</div></section><div className="hidden xl:block"><PersonSummary person={selected} data={query.data} /></div><div className="xl:hidden"><Link href={`/people/${selected.id}`} className="surface flex items-center justify-between p-5 text-sm font-semibold">Open {selected.name}’s workspace <span aria-hidden>→</span></Link></div></div>}</>}
  </DataBoundary>;
}

function PersonRow({ person, active, onSelect }: { person: Person; active: boolean; onSelect: () => void }) {
  return <button onClick={onSelect} aria-pressed={active} className={`grid w-full grid-cols-[44px_minmax(0,1fr)] gap-3 p-4 text-left transition-colors hover:bg-gold-pale/20 ${active ? "bg-gold-pale/30" : ""}`}><Avatar initials={person.initials} name={person.name} /><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold">{person.name}</span>{person.priority === "high" && <span className="text-xs font-bold text-danger">Priority</span>}</span><span className="mt-1 block truncate text-xs text-muted">{person.organization ?? person.email}</span><span className="mt-2 flex flex-wrap items-center gap-2"><StageBadge stage={person.stage} compact />{!person.nextAction && ["follow-up", "pending-signup"].includes(person.stage) && <span className="text-xs font-semibold text-danger">Next action missing</span>}</span></span></button>;
}

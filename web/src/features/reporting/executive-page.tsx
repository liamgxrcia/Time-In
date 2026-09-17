"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DataBoundary } from "@/components/data-boundary";
import { PageHeader } from "@/components/page-header";
import { ActivityChart } from "./activity-chart";
import { stageLabel } from "@/lib/domain";
import { dashboardMetrics, formatDelta } from "@/lib/dashboard-metrics";

export function ExecutivePage() {
  const query = useDashboard();
  const metrics = query.data ? dashboardMetrics(query.data) : null;
  return <DataBoundary isLoading={query.isLoading} isFetching={query.isFetching} error={query.error} onRetry={() => query.refetch()} isEmpty={false} empty={null}>{query.data && metrics && <><PageHeader eyebrow="Executive" title="A measured view of relationship health." description="Active clients, approvals, referrals, retention, operational exceptions, and trend context—without sales theater." /><section className="surface overflow-hidden"><div className="grid lg:grid-cols-[1.2fr_repeat(3,1fr)]"><div className="bg-ink p-6 text-ivory lg:p-8"><p className="eyebrow !text-gold">Portfolio</p><p className="display mt-4 text-5xl">{metrics.activeClients}</p><p className="mt-2 text-sm text-white/65">active client relationships</p><Link href="/clients" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-gold">Open client management <ArrowRight className="size-4" /></Link></div><Metric label="New approvals" value={String(metrics.newApprovals)} trend={formatDelta(metrics.newApprovalsDelta)} up={metrics.newApprovalsDelta > 0} /><Metric label="Referral contribution" value={`${metrics.referralContribution}%`} trend={formatDelta(metrics.referralContributionDelta, "percentage points")} up={metrics.referralContributionDelta > 0} /><Metric label="Needs attention" value={String(metrics.needsAttention)} trend="Current portfolio health" /></div></section><div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="surface p-6"><p className="eyebrow">Activity</p><h2 className="display mb-5 mt-2 text-2xl">Service momentum</h2><ActivityChart data={query.data.trends} /></section><aside className="surface p-6"><p className="eyebrow">Lifecycle mix</p><h2 className="display mt-2 text-2xl">Current relationships</h2><dl className="mt-5 space-y-4">{Object.entries(query.data.people.reduce<Record<string, number>>((counts, person) => ({ ...counts, [person.stage]: (counts[person.stage] ?? 0) + 1 }), {})).map(([stage, count]) => <div key={stage} className="flex items-center justify-between border-b border-border pb-3 text-sm"><dt>{stageLabel[stage as keyof typeof stageLabel]}</dt><dd className="font-semibold tabular-nums">{count}</dd></div>)}</dl></aside></div></>}</DataBoundary>;
}
function Metric({ label, value, trend, up }: { label: string; value: string; trend: string; up?: boolean }) { return <div className="border-t border-border p-6 lg:border-l lg:border-t-0 lg:p-8"><p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p><p className="display mt-4 text-4xl">{value}</p><p className="mt-3 flex items-center gap-1.5 text-xs text-muted">{up ? <ArrowUpRight className="size-3.5 text-success" /> : <ArrowDownRight className="size-3.5" />}{trend}</p></div>; }

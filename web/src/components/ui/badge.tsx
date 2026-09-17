import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, PauseCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { healthLabel, stageLabel, type Health, type Stage } from "@/lib/domain";

const stageIcon: Record<Stage, React.ComponentType<{ className?: string }>> = { new: CircleHelp, "follow-up": Clock3, "pending-signup": AlertTriangle, active: CheckCircle2, paused: PauseCircle, "not-interested": CircleHelp, closed: CircleHelp };
const healthIcon: Record<Health, React.ComponentType<{ className?: string }>> = { strong: CheckCircle2, stable: CheckCircle2, "needs-attention": Clock3, "at-risk": ShieldAlert, unknown: CircleHelp };

export function StageBadge({ stage, compact = false }: { stage: Stage; compact?: boolean }) {
  const Icon = stageIcon[stage];
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-paper px-2.5 py-1 text-xs font-semibold"><Icon className="size-3.5" aria-hidden />{compact ? stageLabel[stage].split(" /")[0] : stageLabel[stage]}</span>;
}
export function HealthBadge({ health }: { health: Health }) {
  const Icon = healthIcon[health];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", health === "at-risk" ? "bg-danger/10 text-danger" : health === "needs-attention" ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}><Icon className="size-3.5" aria-hidden />{healthLabel[health]}</span>;
}

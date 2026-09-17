"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Command, CommandResult } from "@/contracts/crm";
import { api, ApiError } from "@/lib/api/client";
import { dashboardKey } from "./use-dashboard";

/** Keeps an identical request key for uncertain network outcomes, without replaying stale conflicts. */
export function useCommand() {
  const client = useQueryClient();
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; operationId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  async function run(command: Command): Promise<CommandResult | undefined> {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setSaved(false);
    const payload = JSON.stringify(command);
    if (attempt.current?.payload !== payload) attempt.current = { payload, operationId: crypto.randomUUID() };
    try {
      const result = await api.execute({ operationId: attempt.current.operationId, command });
      attempt.current = null;
      await Promise.all([client.invalidateQueries({ queryKey: dashboardKey }), client.invalidateQueries({ queryKey: ["crm"] })]);
      setSaved(true);
      return result;
    } catch (reason) {
      const failure = reason instanceof Error ? reason : new Error("The change could not be saved.");
      setError(failure);
      if (failure instanceof ApiError && ["CONFLICT", "ROLLBACK_CONFLICT", "NOT_FOUND"].includes(failure.code)) {
        attempt.current = null;
        await Promise.all([client.invalidateQueries({ queryKey: dashboardKey }), client.invalidateQueries({ queryKey: ["crm"] })]);
      }
    } finally { pending.current = false; setBusy(false); }
  }
  return { run, busy, error, saved };
}

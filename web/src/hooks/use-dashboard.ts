"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

export const dashboardKey = ["dashboard"] as const;
export function useDashboard() { return useQuery({ queryKey: dashboardKey, queryFn: api.dashboard }); }

"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CloudOff, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { Button } from "./ui/button";

export function DataBoundary({ isLoading, isFetching, error, isEmpty, onRetry, empty, children }: { isLoading: boolean; isFetching?: boolean; error: Error | null; isEmpty: boolean; onRetry: () => void; empty: ReactNode; children: ReactNode }) {
  if (isLoading) return <div className="flex min-h-[45vh] items-center justify-center" role="status"><LoaderCircle className="mr-3 size-5 animate-spin motion-reduce:animate-none" aria-hidden />Loading command center…</div>;
  if (error) {
    const unauthorized = error instanceof ApiError && error.status === 401;
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    const Icon = unauthorized ? LockKeyhole : offline ? CloudOff : AlertTriangle;
    return <section className="surface mx-auto mt-16 max-w-xl p-8 text-center" role="alert"><Icon className="mx-auto mb-4 size-9 text-gold-strong" aria-hidden /><h1 className="display text-3xl font-medium">{unauthorized ? "Session ended" : offline ? "You’re offline" : "This view needs another try"}</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">{unauthorized ? "Sign in again to reopen the private command center." : offline ? "Reconnect to refresh server data. Any form you were editing remains on this device." : error.message}</p><Button className="mt-6" onClick={onRetry}><RefreshCw className="size-4" />Try again</Button></section>;
  }
  if (isEmpty) return empty;
  return <>{isFetching && <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-border bg-paper px-3 py-2 text-xs shadow-lg" role="status"><RefreshCw className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />Refreshing</div>}{children}</>;
}

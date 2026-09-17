"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { ServiceWorkerRegistration } from "./service-worker";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true }, mutations: { retry: 0 } } }));
  return <QueryClientProvider client={client}><TooltipProvider delayDuration={300}>{children}</TooltipProvider><ServiceWorkerRegistration /></QueryClientProvider>;
}

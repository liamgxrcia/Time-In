import { demoMode } from "@/lib/demo-mode";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { requireCEO } from "@/lib/server/supabase";
import { ApiError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export default async function CommandLayout({ children }: { children: React.ReactNode }) {
  const demo = demoMode;
  if (!demo) {
    try { await requireCEO(); }
    catch (error) {
      if (error instanceof ApiError && (error.code === "UNAUTHENTICATED" || error.code === "MFA_REQUIRED")) redirect("/login");
      if (error instanceof ApiError && error.code === "FORBIDDEN") redirect("/login?error=forbidden");
      return <main id="main-content" className="flex min-h-screen items-center justify-center bg-ivory p-6"><section className="surface max-w-lg p-8 text-center"><p className="eyebrow">Configuration required</p><h1 className="display mt-3 text-4xl">The secure backend is unavailable.</h1><p className="mt-4 text-sm leading-6 text-muted">Configure the approved Supabase URL, publishable key, application origin, and CEO access record before opening the command center.</p></section></main>;
    }
  }
  return <AppShell>{children}</AppShell>;
}

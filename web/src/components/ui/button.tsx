import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45", variant === "primary" && "bg-ink text-ivory hover:bg-charcoal", variant === "secondary" && "border border-border bg-paper hover:bg-gold-pale/40", variant === "quiet" && "hover:bg-ink/5", variant === "danger" && "bg-danger text-white hover:bg-danger/90", className)} {...props} />;
}

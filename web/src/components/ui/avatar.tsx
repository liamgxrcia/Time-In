export function Avatar({ initials, name, size = "md" }: { initials: string; name: string; size?: "sm" | "md" | "lg" }) {
  const dimensions = size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-9 text-xs" : "size-11 text-sm";
  return <span role="img" aria-label={`${name} initials`} className={`${dimensions} display inline-flex shrink-0 items-center justify-center rounded-xl bg-charcoal font-semibold tracking-wide text-ivory`}>{initials}</span>;
}

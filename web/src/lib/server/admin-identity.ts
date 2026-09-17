import { createHash, timingSafeEqual } from "node:crypto";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function equalSecret(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

/** Resolve the public username to the private Supabase Auth email. */
export function resolveAdminEmail(username: string): string | null {
  const submitted = username.trim();
  const configuredUsername = process.env.BONUSHUB_ADMIN_USERNAME;
  const configuredEmail = process.env.BONUSHUB_ADMIN_EMAIL?.trim().toLowerCase();
  if (
    configuredUsername &&
    configuredEmail &&
    emailPattern.test(configuredEmail) &&
    equalSecret(submitted, configuredUsername)
  )
    return configuredEmail;
  if (emailPattern.test(submitted)) return submitted.toLowerCase();
  return null;
}

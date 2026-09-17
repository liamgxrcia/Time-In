import type { ApiResponse, ErrorCode } from "@/contracts/crm";
const messages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Sign in to continue.",
  MFA_REQUIRED:
    "Complete your configured multi-factor authentication to continue.",
  FORBIDDEN: "This account cannot access the command center.",
  VALIDATION: "Review the supplied information and try again.",
  NOT_FOUND: "The record is no longer available.",
  CONFLICT: "This record changed. Reload and review before saving.",
  MISSING_NEXT_ACTION: "Choose a next-action type and date.",
  INVALID_TRANSITION: "This lifecycle change is not allowed.",
  ONBOARDING_INCOMPLETE:
    "Complete or explicitly waive required onboarding items before approval.",
  DUPLICATE: "Review the existing matching record.",
  IMPORT_INVALID: "Fix or skip invalid import rows.",
  ROLLBACK_CONFLICT:
    "Imported records have changed or gained related work. Review them before rollback.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  FILE_ACCESS: "This file is unavailable or access has expired.",
  UNAVAILABLE: "This service is not configured or is temporarily unavailable.",
  INTERNAL:
    "The action could not be completed. Existing data has been preserved.",
};
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status = statusFor(code),
  ) {
    super(messages[code]);
  }
}
export function statusFor(code: ErrorCode): number {
  if (code === "UNAUTHENTICATED" || code === "MFA_REQUIRED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (["CONFLICT", "DUPLICATE", "ROLLBACK_CONFLICT"].includes(code)) return 409;
  if (code === "RATE_LIMITED") return 429;
  if (code === "UNAVAILABLE") return 503;
  if (code === "INTERNAL") return 500;
  return 400;
}
export function databaseError(error: {
  message?: string;
  code?: string;
}): ApiError {
  const code = error.message as ErrorCode;
  if (Object.hasOwn(messages, code)) return new ApiError(code);
  if (error.code?.startsWith("23") || error.code?.startsWith("22"))
    return new ApiError("VALIDATION");
  return new ApiError("INTERNAL");
}
export function errorResponse(
  error: unknown,
  requestId: string,
): { body: ApiResponse<never>; status: number } {
  const safe = error instanceof ApiError ? error : new ApiError("INTERNAL");
  return {
    body: {
      data: null,
      error: {
        code: safe.code,
        message: safe.message,
        retryable: ["UNAVAILABLE", "RATE_LIMITED"].includes(safe.code),
      },
      requestId,
    },
    status: safe.status,
  };
}
/** Allowlist only. Never forward arbitrary exception objects, request bodies or headers to logs. */
export function logEvent(event: string, requestId: string, code?: string) {
  console.info(
    JSON.stringify({
      event: event.replace(/[^a-z_.]/gi, ""),
      requestId,
      ...(code ? { code: code.replace(/[^A-Z_]/g, "") } : {}),
    }),
  );
}

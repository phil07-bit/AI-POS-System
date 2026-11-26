export type ErrorCode =
  | "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"
  | "BUSINESS_RULE" | "RATE_LIMITED" | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  BUSINESS_RULE: 422, RATE_LIMITED: 429, INTERNAL_ERROR: 500,
};

export interface FieldIssue { path: string; message: string }

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details: FieldIssue[] = []) {
    super(message);
    this.name = "AppError";
  }
  get status() { return STATUS[this.code]; }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (msg = "You do not have permission to perform this action.") => new AppError("FORBIDDEN", msg);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const businessRule = (msg: string, details: FieldIssue[] = []) => new AppError("BUSINESS_RULE", msg, details);
export const validationError = (msg: string, details: FieldIssue[] = []) => new AppError("VALIDATION_ERROR", msg, details);

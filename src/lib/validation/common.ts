import { z } from "zod";
import { isISODate } from "@/lib/dates";

export const isoDate = z.string().refine(isISODate, "Must be a valid date (YYYY-MM-DD).");
export const uuid = z.string().uuid("Must be a valid ID.");
export const minorAmount = z.number().int("Amount must be in whole pesewas.").positive("Amount must be greater than zero.").max(2_000_000_000);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const requiredText = (max = 200) => z.string().trim().min(1, "Required.").max(max);

/** Ghana numbers: accepts 024xxxxxxx / +23324xxxxxxx / 23324xxxxxxx and normalizes to E.164. */
export function normalizePhone(input: string): string | null {
  const s = input.replace(/[\s\-()]/g, "");
  if (/^0\d{9}$/.test(s)) return `+233${s.slice(1)}`;
  if (/^233\d{9}$/.test(s)) return `+${s}`;
  if (/^\+\d{8,15}$/.test(s)) return s;
  return null;
}

export const phone = z.string().trim().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number, e.g. 024 123 4567 or +233241234567." }); return z.NEVER; }
  return n;
});
export const optionalPhone = z.union([z.literal("").transform(() => null), phone]).optional().nullable().transform((v) => v ?? null);
export const optionalEmail = z.union([z.literal("").transform(() => null), z.string().trim().toLowerCase().email("Enter a valid email address.")]).optional().nullable().transform((v) => v ?? null);

/** Ghana-friendly address: no assumption of street numbers. */
export const addressSchema = z.object({
  country: z.string().trim().max(2).default("GH"),
  region: z.string().trim().max(80).optional().default(""),
  district: z.string().trim().max(120).optional().default(""),
  community: z.string().trim().max(120).optional().default(""),
  landmark: z.string().trim().max(200).optional().default(""),
  digitalAddress: z.string().trim().toUpperCase().max(20)
    .refine((v) => v === "" || /^[A-Z]{2}-?\d{3,4}-?\d{3,4}$/.test(v), "GhanaPostGPS format, e.g. GA-123-4567.")
    .optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
});
export type Address = z.infer<typeof addressSchema>;

export const GHANA_REGIONS = [
  "Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern", "Volta", "Oti",
  "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo",
] as const;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export function paged<T>(items: T[], total: number, p: Pagination): Paged<T> {
  return { items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Pick a sort column from an allowlist (prevents arbitrary orderBy injection). */
export function sortFrom<T extends string>(p: Pagination, allowed: readonly T[], fallback: T): Record<string, "asc" | "desc"> {
  const key = (allowed as readonly string[]).includes(p.sortBy ?? "") ? (p.sortBy as T) : fallback;
  return { [key]: p.sortOrder };
}

import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const money = (m: number | null | undefined, c = "GHS") => <span className="tabular">{formatMoney(m, c)}</span>;
export const date = (d: Date | string | null | undefined) => formatDate(d as string);
export function addressLine(a: { community?: string; district?: string; region?: string; digitalAddress?: string; landmark?: string } | null | undefined) {
  if (!a) return "—";
  return [a.community, a.district, a.region].filter(Boolean).join(", ") + (a.digitalAddress ? ` · ${a.digitalAddress}` : "");
}
export const FREQ: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly", custom: "Custom" };

/** Pass URL search params straight to a list service; the service's zod schema validates/coerces them. */
export function qs(sp: Record<string, string | undefined>, extra: Record<string, string | undefined> = {}): never {
  return Object.fromEntries(Object.entries({ ...sp, ...extra }).filter(([, v]) => v !== undefined && v !== "")) as never;
}

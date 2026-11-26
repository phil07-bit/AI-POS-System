/**
 * Money helpers. Authoritative amounts are ALWAYS integer minor units (pesewas for GHS).
 * Floating point is never used for arithmetic; parsing works on the decimal string directly.
 */

export const CURRENCY_MINOR_DIGITS: Record<string, number> = { GHS: 2, USD: 2, EUR: 2, GBP: 2, NGN: 2, XOF: 0 };

export function minorDigits(currency: string): number {
  return CURRENCY_MINOR_DIGITS[currency] ?? 2;
}

/** Parse a user-entered major-unit string ("1,250.50", "GH₵ 300") into integer minor units. */
export function parseMoneyToMinor(input: string | number, currency = "GHS"): number {
  const digits = minorDigits(currency);
  let s = typeof input === "number" ? input.toFixed(digits) : String(input);
  s = s.replace(/[\s,]/g, "").replace(/^(GH₵|GHS|GH¢|₵|\$)/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid money amount: "${input}"`);
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > digits) throw new Error(`Amount "${input}" has more than ${digits} decimal places`);
  const minor = Number(whole) * 10 ** digits + Number((frac + "0".repeat(digits)).slice(0, digits) || "0");
  if (!Number.isSafeInteger(minor)) throw new Error("Amount is too large");
  return negative ? -minor : minor;
}

/** Plain decimal string ("1250.50") from minor units, for form fields and CSV. */
export function minorToDecimalString(minor: number, currency = "GHS"): string {
  const digits = minorDigits(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  if (digits === 0) return `${negative ? "-" : ""}${abs}`;
  const whole = Math.floor(abs / 10 ** digits);
  const frac = String(abs % 10 ** digits).padStart(digits, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

const SYMBOLS: Record<string, string> = { GHS: "GH₵", USD: "$", EUR: "€", GBP: "£", NGN: "₦" };

/** Display format: "GH₵ 1,250.50". Grouping is done on integers, not floats. */
export function formatMoney(minor: number | null | undefined, currency = "GHS"): string {
  if (minor === null || minor === undefined) return "—";
  const [whole, frac] = minorToDecimalString(Math.abs(minor), currency).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sym = SYMBOLS[currency] ?? currency;
  return `${minor < 0 ? "-" : ""}${sym} ${grouped}${frac !== undefined ? "." + frac : ""}`;
}

export function sumMinor(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) if (v) total += v;
  if (!Number.isSafeInteger(total)) throw new Error("Money total overflow");
  return total;
}

/**
 * Pro-rate an amount by days using integer arithmetic (round half up).
 * Used for a final partial billing period.
 */
export function prorateMinor(amountMinor: number, numeratorDays: number, denominatorDays: number): number {
  if (denominatorDays <= 0) throw new Error("denominatorDays must be positive");
  if (numeratorDays >= denominatorDays) return amountMinor;
  return Math.floor((amountMinor * numeratorDays * 2 + denominatorDays) / (denominatorDays * 2));
}

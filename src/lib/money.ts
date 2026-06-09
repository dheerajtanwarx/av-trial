/* Money helpers — ported from frontend/app/lib/cart-data.ts so the API
   emits the same display strings the frontend already understands. */

/** Format a number as an INR display string, e.g. 68500 -> "₹68,500". */
export const inr = (n: number): string =>
  "₹" + Math.round(n).toLocaleString("en-IN");

/** Parse a display price like "₹68,500" into the number 68500. */
export const parseINR = (s: string | number | null | undefined): number => {
  if (s == null) return 0;
  if (typeof s === "number") return s;
  const digits = s.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
};

/** Coerce a Prisma Decimal | number | string | null into a plain number. */
export const toNumber = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(String(v));
};

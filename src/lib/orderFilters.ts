import { OrderStatus, Prisma } from "../../generated/prisma/client";

/* Shared admin order-filter definitions. The dashboard stat buckets and the
   admin orders list both build on these so a card and the list it links to
   always agree on what e.g. "pending" means. */

/** In-flight orders that still need admin action (not yet delivered/closed). */
export const PENDING_STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
];

/** The single-status filters the admin list understands (plus "all"). */
export const ORDER_STATUS_FILTERS: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
];

/** Derived (grouped / date / payment) filters surfaced alongside the statuses. */
export const DERIVED_ORDER_FILTERS = ["pending", "today", "refunded"] as const;

/** Start of the current calendar day in IST — "today" means the Indian
    business day regardless of server timezone. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function startOfTodayIST(): Date {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  nowIst.setUTCHours(0, 0, 0, 0);
  return new Date(nowIst.getTime() - IST_OFFSET_MS);
}

/** Translate an admin filter key into a Prisma where-fragment, or `null` for
    "all" / unrecognised keys (i.e. no extra constraint). Accepts the single
    statuses (case-insensitive) and the derived `pending` / `today` /
    `refunded` filters. */
export function orderFilterWhere(key: string): Prisma.OrderWhereInput | null {
  const upper = key.toUpperCase();
  if (ORDER_STATUS_FILTERS.includes(upper as OrderStatus)) {
    return { status: upper as OrderStatus };
  }
  switch (key.toLowerCase()) {
    case "pending":
      return { status: { in: PENDING_STATUSES } };
    case "today":
      return { placedAt: { gte: startOfTodayIST() } };
    case "refunded":
      // Orders carrying at least one refunded payment (mock gateway flips
      // captured payments to REFUNDED on cancel/return + the admin refund).
      return { payments: { some: { status: "REFUNDED" } } };
    default:
      return null;
  }
}

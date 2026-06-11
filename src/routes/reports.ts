import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber } from "../lib/money";
import { requireAdmin } from "../middleware/authMiddleware";
import { OrderStatus } from "../../generated/prisma/client";
import { toCsv, sendCsv } from "../lib/csv";

const router = Router();

// Every report route requires an ADMIN session.
router.use(asyncHandler(requireAdmin));

const orderNo = (id: number) => "AVC-" + String(id).padStart(6, "0");

/** Statuses that count toward revenue — cancelled/returned orders are refunded
    (mock gateway) so they're excluded, matching the dashboard definition. */
const REVENUE_STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
];

/** Every status, in fulfilment order, so the orders breakdown is stable. */
const ALL_STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
];

/** Allowed range presets (in days). "all" means no lower bound. */
const RANGE_DAYS: Record<string, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  "365": 365,
  all: null,
};

/** Resolve the ?range= query into a window. Defaults to 30 days. */
function resolveRange(raw: unknown): { key: string; days: number | null; start: Date | null } {
  const key = typeof raw === "string" && raw in RANGE_DAYS ? raw : "30";
  const days = RANGE_DAYS[key];
  if (days == null) return { key, days: null, start: null };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return { key, days, start };
}

/** Local-time YYYY-MM-DD key for day bucketing. */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type SalesDay = {
  date: string;
  orders: number;
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
};

/** Build the per-day sales series + totals for orders placed inside the window.
    Revenue counts only non-refunded (REVENUE_STATUSES) orders. */
async function buildSales(start: Date | null, days: number | null): Promise<{
  daily: SalesDay[];
  totals: { orders: number; grossRevenue: number; discounts: number; netRevenue: number; avgOrderValue: number };
}> {
  const where = start ? { placedAt: { gte: start } } : {};
  const orders = await prisma.order.findMany({
    where,
    select: { placedAt: true, totalAmount: true, discount: true, finalAmount: true, status: true },
    orderBy: { placedAt: "asc" },
  });

  // Pre-seed every day in a fixed-length window so gaps render as zero. For the
  // "all" range we only emit days that actually have orders.
  const buckets = new Map<string, SalesDay>();
  if (start && days) {
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      buckets.set(k, { date: k, orders: 0, grossRevenue: 0, discounts: 0, netRevenue: 0 });
    }
  }

  let totOrders = 0;
  let totGross = 0;
  let totDiscount = 0;
  let totNet = 0;

  for (const o of orders) {
    const counts = REVENUE_STATUSES.includes(o.status);
    const k = dayKey(o.placedAt);
    let b = buckets.get(k);
    if (!b) {
      b = { date: k, orders: 0, grossRevenue: 0, discounts: 0, netRevenue: 0 };
      buckets.set(k, b);
    }
    b.orders += 1;
    totOrders += 1;
    if (counts) {
      const gross = toNumber(o.totalAmount);
      const discount = toNumber(o.discount);
      const net = toNumber(o.finalAmount);
      b.grossRevenue += gross;
      b.discounts += discount;
      b.netRevenue += net;
      totGross += gross;
      totDiscount += discount;
      totNet += net;
    }
  }

  const daily = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  const payingOrders = orders.filter((o) => REVENUE_STATUSES.includes(o.status)).length;

  return {
    daily,
    totals: {
      orders: totOrders,
      grossRevenue: totGross,
      discounts: totDiscount,
      netRevenue: totNet,
      avgOrderValue: payingOrders ? Math.round(totNet / payingOrders) : 0,
    },
  };
}

/* GET /api/admin/reports?range=30 — combined Sales, Orders and Customers
   report for the selected window. All figures come straight from the DB. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const range = resolveRange(req.query.range);
    const orderWhere = range.start ? { placedAt: { gte: range.start } } : {};

    const [sales, byStatusRaw, recentOrders, totalCustomers, newCustomers, topUsersRaw] =
      await Promise.all([
        buildSales(range.start, range.days),
        prisma.order.groupBy({
          by: ["status"],
          where: orderWhere,
          _count: { _all: true },
        }),
        prisma.order.findMany({
          where: orderWhere,
          orderBy: { placedAt: "desc" },
          take: 10,
          include: {
            user: { select: { name: true, email: true } },
            payments: { select: { method: true }, take: 1, orderBy: { id: "asc" } },
            _count: { select: { items: true } },
          },
        }),
        prisma.user.count({ where: { role: "USER" } }),
        prisma.user.count({
          where: { role: "USER", ...(range.start ? { created_at: { gte: range.start } } : {}) },
        }),
        // Top customers by spend in the window (non-refunded orders only).
        prisma.order.groupBy({
          by: ["userId"],
          where: { ...orderWhere, status: { in: REVENUE_STATUSES } },
          _sum: { finalAmount: true },
          _count: { _all: true },
          orderBy: { _sum: { finalAmount: "desc" } },
          take: 10,
        }),
      ]);

    const byStatus = ALL_STATUSES.map((status) => ({
      status,
      count: byStatusRaw.find((g) => g.status === status)?._count._all ?? 0,
    }));
    const totalOrders = byStatus.reduce((s, r) => s + r.count, 0);

    // Hydrate the top-customer rows with their account details.
    const topIds = topUsersRaw.map((g) => g.userId);
    const topUsers = topIds.length
      ? await prisma.user.findMany({
          where: { id: { in: topIds } },
          select: { id: true, name: true, email: true, phone: true },
        })
      : [];
    const userById = new Map(topUsers.map((u) => [u.id, u]));
    const top = topUsersRaw.map((g) => {
      const u = userById.get(g.userId);
      return {
        id: g.userId,
        name: u?.name ?? null,
        email: u?.email ?? null,
        phone: u?.phone ?? null,
        orders: g._count._all,
        spend: toNumber(g._sum.finalAmount),
      };
    });

    res.json({
      range: {
        key: range.key,
        days: range.days,
        start: range.start ? range.start.toISOString() : null,
        end: new Date().toISOString(),
      },
      sales,
      orders: {
        totals: { total: totalOrders, byStatus },
        recent: recentOrders.map((o) => ({
          id: o.id,
          no: orderNo(o.id),
          customer: o.user?.name || o.user?.email || "Guest",
          status: o.status,
          payment: o.payments[0]?.method ?? null,
          itemCount: o._count.items,
          placedAt: o.placedAt,
          total: toNumber(o.finalAmount),
        })),
      },
      customers: {
        totals: { total: totalCustomers, newInRange: newCustomers },
        top,
      },
    });
  })
);

/* ---------- CSV exports ---------- */

/* GET /api/admin/reports/sales.csv?range=30 — per-day sales for the window. */
router.get(
  "/sales.csv",
  asyncHandler(async (req: Request, res: Response) => {
    const range = resolveRange(req.query.range);
    const { daily } = await buildSales(range.start, range.days);
    const csv = toCsv(
      ["Date", "Orders", "Gross Revenue", "Discounts", "Net Revenue"],
      daily.map((d) => [d.date, d.orders, d.grossRevenue, d.discounts, d.netRevenue])
    );
    sendCsv(res, `av-sales-${range.key}`, csv);
  })
);

/* GET /api/admin/reports/orders.csv?range=30 — every order in the window. */
router.get(
  "/orders.csv",
  asyncHandler(async (req: Request, res: Response) => {
    const range = resolveRange(req.query.range);
    const orders = await prisma.order.findMany({
      where: range.start ? { placedAt: { gte: range.start } } : {},
      orderBy: { placedAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
        payments: { select: { method: true }, take: 1, orderBy: { id: "asc" } },
        _count: { select: { items: true } },
      },
    });
    const csv = toCsv(
      [
        "Order No",
        "Placed At",
        "Customer",
        "Email",
        "Status",
        "Payment",
        "Items",
        "Subtotal",
        "Discount",
        "Shipping",
        "Total",
      ],
      orders.map((o) => [
        orderNo(o.id),
        o.placedAt.toISOString(),
        o.user?.name ?? "Guest",
        o.user?.email ?? "",
        o.status,
        o.payments[0]?.method ?? "",
        o._count.items,
        toNumber(o.totalAmount),
        toNumber(o.discount),
        toNumber(o.shippingFee),
        toNumber(o.finalAmount),
      ])
    );
    sendCsv(res, `av-orders-${range.key}`, csv);
  })
);

/* GET /api/admin/reports/customers.csv — every registered customer with their
   lifetime order count + spend (non-refunded). Range-independent: a customer
   list is most useful as the full book of accounts. */
router.get(
  "/customers.csv",
  asyncHandler(async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      where: { role: "USER" },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        created_at: true,
        _count: { select: { orders: true } },
      },
    });

    // One grouped query for lifetime spend across all listed customers.
    const ids = users.map((u) => u.id);
    const spendRows = ids.length
      ? await prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { in: REVENUE_STATUSES } },
          _sum: { finalAmount: true },
        })
      : [];
    const spend = new Map<number, number>();
    for (const g of spendRows) spend.set(g.userId, toNumber(g._sum.finalAmount));

    const csv = toCsv(
      ["Customer ID", "Name", "Email", "Phone", "Registered", "Total Orders", "Lifetime Spend"],
      users.map((u) => [
        u.id,
        u.name ?? "",
        u.email ?? "",
        u.phone ?? "",
        u.created_at.toISOString(),
        u._count.orders,
        spend.get(u.id) ?? 0,
      ])
    );
    sendCsv(res, "av-customers", csv);
  })
);

export default router;

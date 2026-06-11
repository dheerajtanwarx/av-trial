import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber } from "../lib/money";
import { requireAdmin } from "../middleware/authMiddleware";
import { OrderStatus, Prisma } from "../../generated/prisma/client";

const router = Router();

// Every customer route requires an ADMIN session.
router.use(asyncHandler(requireAdmin));

const orderNo = (id: number) => "AVC-" + String(id).padStart(6, "0");

/** Statuses that count toward a customer's lifetime spend — cancelled/returned
    orders are refunded (mock gateway) so they're excluded, matching the
    dashboard's revenue definition. */
const SPEND_STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
];

const PAYMENT_LABEL = (p: string | null) => p ?? null;

/* GET /api/admin/customers — paginated customer list with search.
   Query: q (name / email / phone), page, pageSize. Returns each customer with
   their registration date, total order count and lifetime spend. Newest
   customers first. Only role USER accounts are listed (admins are excluded,
   matching the dashboard's customer count). */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 12));

    const where: Prisma.UserWhereInput = { role: "USER" };
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          created_at: true,
          _count: { select: { orders: true } },
        },
      }),
    ]);

    // Lifetime spend for just this page of customers (one grouped query rather
    // than N per-row aggregates).
    const ids = users.map((u) => u.id);
    const spendByUser = ids.length
      ? await prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { in: SPEND_STATUSES } },
          _sum: { finalAmount: true },
        })
      : [];
    const spend = new Map<number, number>();
    for (const g of spendByUser) spend.set(g.userId, toNumber(g._sum.finalAmount));

    res.json({
      customers: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        registeredAt: u.created_at,
        totalOrders: u._count.orders,
        totalSpending: spend.get(u.id) ?? 0,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/* GET /api/admin/customers/:id — full customer profile: account information,
   order history, saved addresses and wishlist count. */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid customer id" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        created_at: true,
        _count: { select: { wishlist: true } },
        addresses: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        },
        orders: {
          orderBy: { placedAt: "desc" },
          select: {
            id: true,
            status: true,
            finalAmount: true,
            placedAt: true,
            payments: { select: { method: true }, take: 1, orderBy: { id: "asc" } },
            _count: { select: { items: true } },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    // Lifetime spend = sum of non-refunded orders (computed from the included
    // rows so we don't issue a second query).
    const totalSpending = user.orders
      .filter((o) => SPEND_STATUSES.includes(o.status))
      .reduce((sum, o) => sum + toNumber(o.finalAmount), 0);

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      registeredAt: user.created_at,
      stats: {
        totalOrders: user.orders.length,
        totalSpending,
        wishlistCount: user._count.wishlist,
      },
      orders: user.orders.map((o) => ({
        id: o.id,
        no: orderNo(o.id),
        status: o.status,
        placedAt: o.placedAt,
        total: toNumber(o.finalAmount),
        payment: PAYMENT_LABEL(o.payments[0]?.method ?? null),
        itemCount: o._count.items,
      })),
      addresses: user.addresses.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        phone: a.phone,
        street: a.street,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        country: a.country,
        isDefault: a.isDefault,
      })),
    });
  })
);

export default router;

import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, isEmail } from "../lib/http";
import { toNumber, inr } from "../lib/money";
import { requireAuth, optionalAuth } from "../middleware/authMiddleware";
import { PaymentMethod, PaymentStatus } from "../../generated/prisma/client";

const router = Router();

const PAYMENT_MAP: Record<string, PaymentMethod> = {
  upi: "UPI",
  card: "CARD",
  netbanking: "NETBANKING",
  cod: "COD",
  wallet: "WALLET",
};

const SHIPPING: Record<string, { fee: number; days: number }> = {
  standard: { fee: 0, days: 28 },
  priority: { fee: 1200, days: 18 },
};

const orderNo = (id: number) => "AVC-" + String(id).padStart(6, "0");

/** Parse a human order number ("AVC-000024" / "avc-24" / "24") back to its id. */
function parseOrderNo(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type IncomingItem = { slug?: string; color?: string; size?: string; qty?: number };

/* POST /api/orders/track — public order lookup by order number + email.
   No auth: the email acts as the shared secret. Matches against the buyer's
   account email (set for Google + guest checkouts). */
router.post(
  "/track",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseOrderNo(req.body?.orderNo);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!id || !isEmail(email)) {
      res.status(400).json({ error: "Enter a valid order ID and email." });
      return;
    }
    const order = await prisma.order.findUnique({
      where: { id },
      include: { ...orderInclude, user: { select: { email: true } } },
    });
    if (!order || (order.user.email ?? "").toLowerCase() !== email) {
      res.status(404).json({ error: "No order found for that ID and email." });
      return;
    }
    res.json(serializeOrder(order));
  })
);

/* POST /api/orders — guest or authenticated checkout. */
router.post(
  "/",
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];
    const address = body.address ?? {};
    const paymentId = String(body.payment ?? "").toLowerCase();
    const deliveryId = String(body.delivery ?? "standard").toLowerCase();
    const promoCode = body.promoCode
      ? String(body.promoCode).trim().toUpperCase()
      : null;

    if (items.length === 0) {
      res.status(400).json({ error: "Your bag is empty" });
      return;
    }
    const required = ["first", "last", "email", "phone", "address", "pin", "city", "state"];
    for (const f of required) {
      if (!address[f] || String(address[f]).trim() === "") {
        res.status(400).json({ error: `Missing address field: ${f}` });
        return;
      }
    }
    if (!isEmail(address.email)) {
      res.status(400).json({ error: "Enter a valid email" });
      return;
    }
    const method = PAYMENT_MAP[paymentId];
    if (!method) {
      res.status(400).json({ error: "Choose a valid payment method" });
      return;
    }
    const shipping = SHIPPING[deliveryId] ?? SHIPPING.standard;

    // Resolve each cart line to a concrete ProductVariant.
    const resolved: {
      variantId: number;
      size: string | null;
      qty: number;
      unitPrice: number;
    }[] = [];
    for (const it of items) {
      const qty = Math.max(1, Number(it.qty ?? 1));
      const product = await prisma.product.findUnique({
        where: { slug: String(it.slug ?? "") },
        include: { variants: { orderBy: { id: "asc" } } },
      });
      if (!product || product.variants.length === 0) {
        res.status(400).json({ error: `Unknown product: ${it.slug}` });
        return;
      }
      const variant =
        product.variants.find(
          (v) => v.color.toLowerCase() === String(it.color ?? "").toLowerCase()
        ) ?? product.variants[0];
      resolved.push({
        variantId: variant.id,
        size: it.size ?? null,
        qty,
        unitPrice: toNumber(variant.price),
      });
    }

    const subtotal = resolved.reduce((s, r) => s + r.unitPrice * r.qty, 0);

    // Promo discount (server-validated).
    let discount = 0;
    if (promoCode) {
      const promo = await prisma.promo.findUnique({ where: { code: promoCode } });
      const valid =
        promo &&
        promo.active &&
        (!promo.expiresAt || promo.expiresAt >= new Date()) &&
        (!promo.minSpend || subtotal >= toNumber(promo.minSpend));
      if (valid) discount = Math.round(subtotal * toNumber(promo.pct));
    }

    const finalAmount = subtotal - discount + shipping.fee;

    // Find-or-create the buyer (guest checkout auto-creates / links by email).
    let userId: number;
    if (req.currentUser) {
      userId = Number(req.currentUser.id);
    } else {
      const email = String(address.email).toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      userId = existing
        ? existing.id
        : (
            await prisma.user.create({
              data: {
                email,
                name: `${address.first} ${address.last}`.trim(),
                phone: String(address.phone),
              },
            })
          ).id;
    }

    const paymentStatus: PaymentStatus = method === "COD" ? "PENDING" : "SUCCESS";

    const order = await prisma.$transaction(async (tx) => {
      const addr = await tx.address.create({
        data: {
          userId,
          fullName: `${address.first} ${address.last}`.trim(),
          phone: String(address.phone),
          street: String(address.address),
          city: String(address.city),
          state: String(address.state),
          pincode: String(address.pin),
        },
      });

      const created = await tx.order.create({
        data: {
          userId,
          addressId: addr.id,
          totalAmount: subtotal,
          discount,
          finalAmount,
          shippingMethod: deliveryId,
          shippingFee: shipping.fee,
          status: "PLACED",
          items: {
            create: resolved.map((r) => ({
              variantId: r.variantId,
              size: r.size,
              quantity: r.qty,
              unitPrice: r.unitPrice,
              totalPrice: r.unitPrice * r.qty,
            })),
          },
          payments: {
            create: {
              method,
              status: paymentStatus,
              amount: finalAmount,
              gateway: "mock",
              paidAt: paymentStatus === "SUCCESS" ? new Date() : null,
            },
          },
        },
      });

      // Decrement stock per line.
      for (const r of resolved) {
        await tx.productVariant.update({
          where: { id: r.variantId },
          data: { stockQty: { decrement: r.qty } },
        });
      }

      return created;
    });

    const etaDate = new Date(Date.now() + shipping.days * 86_400_000);
    const eta = etaDate.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

    res.status(201).json({
      no: orderNo(order.id),
      id: order.id,
      eta,
      etaWindow: deliveryId === "priority" ? "2–3 weeks" : "3–4 weeks",
      subtotal,
      discount,
      shippingFee: shipping.fee,
      total: finalAmount,
      status: order.status,
    });
  })
);

const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/* Shape an order row for the read endpoints. */
function serializeOrder(o: any) {
  const returnEligibleUntil =
    o.status === "DELIVERED"
      ? new Date(new Date(o.updatedAt).getTime() + RETURN_WINDOW_MS).toISOString()
      : null;

  return {
    no: orderNo(o.id),
    id: o.id,
    status: o.status,
    placedAt: o.placedAt,
    returnEligibleUntil,
    subtotal: toNumber(o.totalAmount),
    discount: toNumber(o.discount),
    shippingFee: toNumber(o.shippingFee),
    total: toNumber(o.finalAmount),
    shippingMethod: o.shippingMethod,
    trackingNumber: o.trackingNumber,
    address: o.address,
    payment: o.payments?.[0]?.method ?? null,
    items: (o.items ?? []).map((it: any) => ({
      productId: it.variant.product.id,
      name: it.variant.product.name,
      slug: it.variant.product.slug,
      color: it.variant.color,
      size: it.size,
      qty: it.quantity,
      unitPrice: toNumber(it.unitPrice),
      price: inr(toNumber(it.unitPrice)),
      image: it.variant.product.images?.[0]?.imageUrl ?? "",
    })),
  };
}

const orderInclude = {
  address: true,
  payments: true,
  items: {
    include: {
      variant: {
        include: {
          product: {
            include: {
              images: { select: { imageUrl: true }, orderBy: { sortOrder: "asc" as const }, take: 1 },
            },
          },
        },
      },
    },
  },
};

/* GET /api/orders — the signed-in user's orders. */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const orders = await prisma.order.findMany({
      where: { userId },
      include: orderInclude,
      orderBy: { placedAt: "desc" },
    });
    res.json(orders.map(serializeOrder));
  })
);

/* GET /api/orders/:id — a single order (ownership-checked). */
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!order || order.userId !== Number(req.currentUser!.id)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(serializeOrder(order));
  })
);

/* PATCH /api/orders/:id/cancel — cancel if still PLACED or CONFIRMED */
router.patch(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== Number(req.currentUser!.id)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!["PLACED", "CONFIRMED"].includes(order.status)) {
      res.status(400).json({ error: "This order can no longer be cancelled" });
      return;
    }
    const updated = await prisma.order.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: orderInclude,
    });
    res.json(serializeOrder(updated));
  })
);

/* PATCH /api/orders/:id/return — request a return within 7 days of delivery */
router.patch(
  "/:id/return",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== Number(req.currentUser!.id)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.status !== "DELIVERED") {
      res.status(400).json({ error: "Only delivered orders can be returned" });
      return;
    }
    const deadline = new Date(new Date(order.updatedAt).getTime() + RETURN_WINDOW_MS);
    if (new Date() > deadline) {
      res.status(400).json({ error: "Return window has closed. Returns must be requested within 7 days of delivery." });
      return;
    }
    const reason = req.body?.reason ? String(req.body.reason) : null;
    const updated = await prisma.order.update({
      where: { id },
      data: { status: "RETURNED", notes: reason ?? order.notes },
      include: orderInclude,
    });
    res.json(serializeOrder(updated));
  })
);

/* PATCH /api/orders/:id/advance — DEV ONLY. Moves an order one step along the
   fulfilment path (PLACED → CONFIRMED → PROCESSING → SHIPPED → DELIVERED) so the
   return + review flows (which require a DELIVERED order) can be tested end-to-end
   without an admin panel. Disabled in production. */
const FULFILMENT_FLOW = ["PLACED", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"];

router.patch(
  "/:id/advance",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({ error: "Not available" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== Number(req.currentUser!.id)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const idx = FULFILMENT_FLOW.indexOf(order.status);
    if (idx === -1 || idx === FULFILMENT_FLOW.length - 1) {
      res.status(400).json({ error: `Order can't be advanced from ${order.status}` });
      return;
    }
    const next = FULFILMENT_FLOW[idx + 1] as typeof order.status;
    const updated = await prisma.order.update({
      where: { id },
      data: { status: next },
      include: orderInclude,
    });
    res.json(serializeOrder(updated));
  })
);

export default router;

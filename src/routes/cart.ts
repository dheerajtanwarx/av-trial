import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber, inr } from "../lib/money";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();
router.use(requireAuth);

type ResolvedVariant = { id: number; stockQty: number; color: string; name: string };

/** Resolve a { slug, color } pair to a concrete variant (with current stock). */
async function resolveVariant(slug: string, color?: string): Promise<ResolvedVariant | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: { variants: { orderBy: { id: "asc" } } },
  });
  if (!product || product.variants.length === 0) return null;
  const variant =
    product.variants.find(
      (v) => v.color.toLowerCase() === String(color ?? "").toLowerCase()
    ) ?? product.variants[0];
  return { id: variant.id, stockQty: variant.stockQty, color: variant.color, name: product.name };
}

const cartItemInclude = {
  variant: {
    include: {
      product: {
        include: {
          images: {
            select: { imageUrl: true },
            orderBy: { sortOrder: "asc" as const },
            take: 1,
          },
        },
      },
    },
  },
};

function serializeCartItem(c: any) {
  return {
    id: c.id,
    variantId: c.variantId,
    slug: c.variant.product.slug,
    name: c.variant.product.name,
    type: c.variant.product.type,
    color: { name: c.variant.color, hex: c.variant.colorHex },
    qty: c.quantity,
    stock: c.variant.stockQty,
    unitPrice: toNumber(c.variant.price),
    price: inr(toNumber(c.variant.price)),
    img: c.variant.product.images?.[0]?.imageUrl ?? "",
  };
}

/* GET /api/cart */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const items = await prisma.cartItem.findMany({
      where: { userId },
      include: cartItemInclude,
      orderBy: { addedAt: "asc" },
    });
    res.json(items.map(serializeCartItem));
  })
);

/* POST /api/cart — { slug, color?, qty? } */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const { slug, color } = req.body ?? {};
    const qty = Math.max(1, Number(req.body?.qty ?? 1));
    if (!slug) {
      res.status(400).json({ error: "slug is required" });
      return;
    }
    const variant = await resolveVariant(String(slug), color);
    if (!variant) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    if (variant.stockQty <= 0) {
      res.status(409).json({
        error: `${variant.name} (${variant.color}) is out of stock`,
        code: "OUT_OF_STOCK",
      });
      return;
    }
    // Cap the line at available stock (the cart is not a reservation; the
    // order endpoint re-checks at checkout).
    const existing = await prisma.cartItem.findUnique({
      where: { userId_variantId: { userId, variantId: variant.id } },
    });
    const target = Math.min((existing?.quantity ?? 0) + qty, variant.stockQty);
    const item = await prisma.cartItem.upsert({
      where: { userId_variantId: { userId, variantId: variant.id } },
      update: { quantity: target },
      create: { userId, variantId: variant.id, quantity: target },
      include: cartItemInclude,
    });
    res.status(201).json(serializeCartItem(item));
  })
);

/* PATCH /api/cart/:id — { qty } (0 or less removes the line). */
router.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const id = Number(req.params.id);
    const qty = Number(req.body?.qty);
    if (!Number.isInteger(id) || !Number.isFinite(qty)) {
      res.status(400).json({ error: "Invalid id or qty" });
      return;
    }
    const existing = await prisma.cartItem.findUnique({
      where: { id },
      include: { variant: { select: { stockQty: true } } },
    });
    if (!existing || existing.userId !== userId) {
      res.status(404).json({ error: "Cart item not found" });
      return;
    }
    if (qty <= 0) {
      await prisma.cartItem.delete({ where: { id } });
      res.json({ ok: true, removed: true });
      return;
    }
    const item = await prisma.cartItem.update({
      where: { id },
      data: { quantity: Math.min(qty, Math.max(1, existing.variant.stockQty)) },
      include: cartItemInclude,
    });
    res.json(serializeCartItem(item));
  })
);

/* DELETE /api/cart/:id */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const id = Number(req.params.id);
    const existing = await prisma.cartItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      res.status(404).json({ error: "Cart item not found" });
      return;
    }
    await prisma.cartItem.delete({ where: { id } });
    res.json({ ok: true });
  })
);

/* POST /api/cart/merge — { items: [{ slug, color?, qty? }] } merges a guest's
   localStorage cart into the server cart on login. */
router.post(
  "/merge",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    for (const it of items) {
      if (!it?.slug) continue;
      const qty = Math.max(1, Number(it.qty ?? 1));
      const variant = await resolveVariant(String(it.slug), it.color);
      if (!variant || variant.stockQty <= 0) continue;
      const existing = await prisma.cartItem.findUnique({
        where: { userId_variantId: { userId, variantId: variant.id } },
      });
      const target = Math.min((existing?.quantity ?? 0) + qty, variant.stockQty);
      await prisma.cartItem.upsert({
        where: { userId_variantId: { userId, variantId: variant.id } },
        update: { quantity: target },
        create: { userId, variantId: variant.id, quantity: target },
      });
    }
    const merged = await prisma.cartItem.findMany({
      where: { userId },
      include: cartItemInclude,
      orderBy: { addedAt: "asc" },
    });
    res.json(merged.map(serializeCartItem));
  })
);

export default router;

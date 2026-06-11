import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber, inr } from "../lib/money";
import { starsFor } from "../lib/serialize";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();
// Every wishlist route is private — only the signed-in owner may touch it.
router.use(requireAuth);

// Pull just enough of each product to render a wishlist card + availability.
const wishlistInclude = {
  product: {
    include: {
      images: {
        select: { imageUrl: true, sortOrder: true, isPrimary: true },
        orderBy: { sortOrder: "asc" as const },
      },
      variants: { select: { stockQty: true } },
    },
  },
};

type WishlistRow = {
  id: number;
  productId: number;
  product: {
    slug: string;
    name: string;
    type: string | null;
    basePrice: unknown;
    comparePrice: unknown;
    rating: number | null;
    images: { imageUrl: string; sortOrder: number; isPrimary: boolean }[];
    variants: { stockQty: number }[];
  };
};

function serializeWishlistItem(w: WishlistRow) {
  const p = w.product;
  const base = toNumber(p.basePrice);
  const was = toNumber(p.comparePrice);
  const isSale = was > base;

  const imgs = [...p.images].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder
  );
  // In stock when at least one variant has stock; products with no variants
  // recorded are treated as available.
  const inStock =
    p.variants.length === 0 || p.variants.some((v) => v.stockQty > 0);

  return {
    id: w.id,
    productId: w.productId,
    slug: p.slug,
    name: p.name,
    type: p.type ?? "",
    price: inr(base),
    was: isSale ? inr(was) : null,
    stars: starsFor(p.rating),
    img: imgs[0]?.imageUrl ?? "",
    inStock,
  };
}

/** Resolve a product slug to its id (only active products are wishlistable). */
async function resolveProductId(slug: string): Promise<number | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    select: { id: true, isActive: true },
  });
  if (!product || !product.isActive) return null;
  return product.id;
}

/* GET /api/wishlist — the signed-in user's saved products. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const items = await prisma.wishlistItem.findMany({
      where: { userId },
      include: wishlistInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(items.map(serializeWishlistItem));
  })
);

/* POST /api/wishlist — { slug }. Adds a product. Duplicates are a no-op
   (idempotent) rather than an error, so repeat clicks are harmless. */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const slug = req.body?.slug;
    if (!slug || typeof slug !== "string") {
      res.status(400).json({ error: "slug is required" });
      return;
    }
    const productId = await resolveProductId(slug);
    if (!productId) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
      include: wishlistInclude,
    });
    if (existing) {
      // Already wishlisted — return it as-is so the client stays in sync.
      res.status(200).json({ ...serializeWishlistItem(existing), already: true });
      return;
    }

    const created = await prisma.wishlistItem.create({
      data: { userId, productId },
      include: wishlistInclude,
    });
    res.status(201).json(serializeWishlistItem(created));
  })
);

/* DELETE /api/wishlist/:slug — remove a product from the wishlist. */
router.delete(
  "/:slug",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const productId = await resolveProductId(String(req.params.slug));
    if (!productId) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (!existing) {
      res.status(404).json({ error: "Not in wishlist" });
      return;
    }
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

/* POST /api/wishlist/merge — { slugs: string[] } folds a guest's localStorage
   wishlist into the server wishlist on login, then returns the full list. */
router.post(
  "/merge",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const slugs: string[] = Array.isArray(req.body?.slugs)
      ? req.body.slugs.filter((s: unknown): s is string => typeof s === "string")
      : [];

    for (const slug of slugs) {
      const productId = await resolveProductId(slug);
      if (!productId) continue;
      // upsert keeps it idempotent — no duplicate rows, no error on re-merge.
      await prisma.wishlistItem.upsert({
        where: { userId_productId: { userId, productId } },
        update: {},
        create: { userId, productId },
      });
    }

    const merged = await prisma.wishlistItem.findMany({
      where: { userId },
      include: wishlistInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(merged.map(serializeWishlistItem));
  })
);

export default router;

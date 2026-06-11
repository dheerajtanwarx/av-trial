import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { serializeProductCard } from "../lib/serialize";
import { inr, toNumber } from "../lib/money";
import {
  buildPdp,
  buildReviewDist,
  PdpReview,
  RelatedItem,
} from "../lib/pdp";

const router = Router();

const imageInclude = {
  select: { imageUrl: true, sortOrder: true, isPrimary: true },
  orderBy: { sortOrder: "asc" },
} as const;

/* GET /api/products?category=<slug>&bestseller=true — landing Product cards. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const category = req.query.category;
    const bestseller = req.query.bestseller;

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(typeof category === "string"
          ? { category: { slug: category } }
          : {}),
        ...(bestseller === "true" ? { isBestseller: true } : {}),
      },
      include: { images: imageInclude, variants: { select: { stockQty: true } } },
      orderBy: { createdAt: "asc" },
    });

    res.json(products.map(serializeProductCard));
  })
);

/* GET /api/products/:slug/reviews — approved reviews + distribution. */
router.get(
  "/:slug/reviews",
  asyncHandler(async (req: Request, res: Response) => {
    const product = await prisma.product.findUnique({
      where: { slug: String(req.params.slug) },
      select: { id: true },
    });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const rows = await prisma.review.findMany({
      where: { productId: product.id, isApproved: true },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const reviews: PdpReview[] = rows.map((r) => ({
      stars: r.rating,
      txt: r.comment ?? "",
      name: r.user.name ?? "Verified Buyer",
      loc: "Verified",
    }));
    const reviewDist = buildReviewDist(rows.map((r) => r.rating));

    res.json({ reviews, reviewDist, count: rows.length });
  })
);

/* GET /api/products/:slug — full PdpProduct shape. */
router.get(
  "/:slug",
  asyncHandler(async (req: Request, res: Response) => {
    const product = await prisma.product.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        images: imageInclude,
        variants: { orderBy: { id: "asc" } },
      },
    });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const reviewRows = await prisma.review.findMany({
      where: { productId: product.id, isApproved: true },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const reviews: PdpReview[] = reviewRows.map((r) => ({
      stars: r.rating,
      txt: r.comment ?? "",
      name: r.user.name ?? "Verified Buyer",
      loc: "Verified",
    }));

    // Related: other active products, preferring the same category.
    const relatedRows = await prisma.product.findMany({
      where: { isActive: true, slug: { not: product.slug } },
      include: { images: imageInclude },
      orderBy: { createdAt: "asc" },
      take: 8,
    });
    const related: RelatedItem[] = relatedRows
      .sort(
        (a, b) =>
          Number(b.categoryId === product.categoryId) -
          Number(a.categoryId === product.categoryId)
      )
      .slice(0, 4)
      .map((r) => {
        const base = toNumber(r.basePrice);
        const was = toNumber(r.comparePrice);
        const isSale = was > base;
        return {
          slug: r.slug,
          nm: r.name,
          ty: r.type ?? "",
          pr: inr(base),
          was: isSale ? inr(was) : undefined,
          image: r.images[0]?.imageUrl ?? "",
          flag: isSale
            ? r.badge ?? `Off ${Math.round((1 - base / was) * 100)}%`
            : r.badge ?? undefined,
        };
      });

    const pdp = buildPdp({
      product,
      images: product.images.map((i) => i.imageUrl),
      colors: product.variants.map((v) => ({
        name: v.color,
        hex: v.colorHex,
        stock: v.stockQty,
      })),
      reviews,
      reviewDist: buildReviewDist(reviewRows.map((r) => r.rating)),
      related,
    });

    res.json(pdp);
  })
);

export default router;

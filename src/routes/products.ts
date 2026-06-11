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
import { Prisma, Product, ProductImage, ProductVariant, Review } from "../../generated/prisma/client";

const router = Router();

const imageInclude = {
  select: { imageUrl: true, sortOrder: true, isPrimary: true },
  orderBy: { sortOrder: "asc" },
} as const;

// PDP needs to know which variant each image belongs to so the gallery can
// swap with the selected colour; the listing/related queries don't.
const pdpImageInclude = {
  select: { imageUrl: true, sortOrder: true, isPrimary: true, variantId: true },
  orderBy: { sortOrder: "asc" },
} as const;

/** Split a comma-separated query param into a trimmed, de-duped list. */
function splitCsv(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Break a product `type` string ("Bandhej · Pure Georgette") into tag tokens. */
function tagsFromType(type: string | null | undefined): string[] {
  if (!type) return [];
  return type
    .split(/[·&,/|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

type SortKey = "featured" | "price-asc" | "price-desc" | "newest" | "rating";

const ORDER_BY: Record<SortKey, Prisma.ProductOrderByWithRelationInput> = {
  featured: { createdAt: "asc" },
  "price-asc": { basePrice: "asc" },
  "price-desc": { basePrice: "desc" },
  newest: { createdAt: "desc" },
  rating: { rating: "desc" },
};

/* GET /api/products
   Search + filter across the whole catalogue. All params optional:
     q          full-text across name, type, description, badge, category name
     category   one or more category slugs (comma-separated)
     tag        one or more tag tokens, matched within a product's `type`
     bestseller "true" — bestsellers only
     sale       "true" — on-sale only (comparePrice > basePrice)
     minPrice   lower bound on basePrice
     maxPrice   upper bound on basePrice
     sort       featured | price-asc | price-desc | newest | rating */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const slugs = splitCsv(req.query.category);
    const tags = splitCsv(req.query.tag);
    const bestseller = req.query.bestseller === "true";
    const sale = req.query.sale === "true";
    const sort = (req.query.sort as SortKey) || "featured";

    const and: Prisma.ProductWhereInput[] = [];

    if (q) {
      and.push({
        OR: [
          { name: { contains: q } },
          { type: { contains: q } },
          { description: { contains: q } },
          { badge: { contains: q } },
          { category: { name: { contains: q } } },
        ],
      });
    }

    // Tag tokens live inside the free-text `type` column; match any selected tag.
    if (tags.length > 0) {
      and.push({ OR: tags.map((t) => ({ type: { contains: t } })) });
    }

    const price: Prisma.DecimalFilter = {};
    const min = Number(req.query.minPrice);
    const max = Number(req.query.maxPrice);
    if (req.query.minPrice !== undefined && Number.isFinite(min)) price.gte = min;
    if (req.query.maxPrice !== undefined && Number.isFinite(max)) price.lte = max;

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(slugs.length === 1
        ? { category: { slug: slugs[0] } }
        : slugs.length > 1
        ? { category: { slug: { in: slugs } } }
        : {}),
      ...(bestseller ? { isBestseller: true } : {}),
      ...(Object.keys(price).length ? { basePrice: price } : {}),
      ...(and.length ? { AND: and } : {}),
    };

    let products = await prisma.product.findMany({
      where,
      include: {
        images: imageInclude,
        variants: { select: { stockQty: true, color: true, colorHex: true } },
        category: { select: { name: true, slug: true } },
      },
      orderBy: ORDER_BY[sort] ?? ORDER_BY.featured,
    });

    // On-sale is a column-vs-column comparison Prisma can't express in `where`.
    if (sale) {
      products = products.filter(
        (p) => p.comparePrice != null && toNumber(p.comparePrice) > toNumber(p.basePrice)
      );
    }

    res.json(products.map(serializeProductCard));
  })
);

/* GET /api/products/facets — filter options for the search/listing UI. */
router.get(
  "/facets",
  asyncHandler(async (_req: Request, res: Response) => {
    const [grouped, types, agg] = await Promise.all([
      prisma.product.groupBy({
        by: ["categoryId"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.product.findMany({
        where: { isActive: true, type: { not: null } },
        select: { type: true },
        distinct: ["type"],
      }),
      prisma.product.aggregate({
        where: { isActive: true },
        _min: { basePrice: true },
        _max: { basePrice: true },
      }),
    ]);

    const countByCat = new Map(grouped.map((g) => [g.categoryId, g._count._all]));
    const cats = await prisma.category.findMany({
      where: { id: { in: [...countByCat.keys()] } },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });

    const tagSet = new Set<string>();
    for (const t of types) for (const tag of tagsFromType(t.type)) tagSet.add(tag);

    res.json({
      categories: cats.map((c) => ({
        name: c.name,
        slug: c.slug,
        count: countByCat.get(c.id) ?? 0,
      })),
      tags: [...tagSet].sort((a, b) => a.localeCompare(b)),
      priceRange: {
        min: Math.floor(toNumber(agg._min.basePrice ?? 0)),
        max: Math.ceil(toNumber(agg._max.basePrice ?? 0)),
      },
    });
  })
);

/* POST /api/products/stock — live stock for a set of { slug, color } lines.
   Public (no auth) so guest carts can revalidate too. Used by the cart to flag
   items that have sold out since they were added. Returns one row per input
   line with its current per-variant stock (0 if the product/colour is gone). */
router.post(
  "/stock",
  asyncHandler(async (req: Request, res: Response) => {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items: { slug: string; color: string }[] = rawItems
      .map((it: { slug?: unknown; color?: unknown }) => ({
        slug: String(it?.slug ?? "").trim(),
        color: it?.color != null ? String(it.color).trim() : "",
      }))
      .filter((it: { slug: string }) => it.slug !== "")
      .slice(0, 100);

    if (items.length === 0) {
      res.json({ items: [] });
      return;
    }

    // One query for every referenced product, then resolve each line in memory.
    const slugs: string[] = [...new Set(items.map((it) => it.slug))];
    const products = await prisma.product.findMany({
      where: { slug: { in: slugs } },
      select: {
        slug: true,
        isActive: true,
        variants: { select: { color: true, stockQty: true }, orderBy: { id: "asc" } },
      },
    });
    const bySlug = new Map(products.map((p) => [p.slug, p]));

    const result = items.map((it) => {
      const product = bySlug.get(it.slug);
      if (!product || !product.isActive || product.variants.length === 0) {
        return { slug: it.slug, color: it.color, stock: 0 };
      }
      const variant =
        product.variants.find((v) => v.color.toLowerCase() === it.color.toLowerCase()) ??
        product.variants[0];
      return { slug: it.slug, color: it.color, stock: Math.max(0, variant.stockQty) };
    });

    res.json({ items: result });
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

    const reviews: PdpReview[] = rows.map((r: typeof rows[number]) => ({
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
        images: pdpImageInclude,
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
    const reviews: PdpReview[] = reviewRows.map((r: typeof reviewRows[number]) => ({
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
      .sort((a: typeof relatedRows[number], b: typeof relatedRows[number]) =>
        Number(b.categoryId === product.categoryId) - Number(a.categoryId === product.categoryId)
      )
      .slice(0, 4)
      .map((r: typeof relatedRows[number]) => {
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

    // Group images by the variant they belong to. Images with no variantId are
    // "shared" product shots used as a fallback for colours that have none of
    // their own. Rows arrive pre-sorted by sortOrder from the query.
    const imagesByVariant = new Map<number, string[]>();
    const sharedImages: string[] = [];
    for (const im of product.images) {
      if (im.variantId == null) {
        sharedImages.push(im.imageUrl);
      } else {
        const list = imagesByVariant.get(im.variantId) ?? [];
        list.push(im.imageUrl);
        imagesByVariant.set(im.variantId, list);
      }
    }
    const allImages = product.images.map((i: typeof product.images[number]) => i.imageUrl);

    const pdp = buildPdp({
      product,
      images: allImages,
      colors: product.variants.map((v: typeof product.variants[number]) => {
        const own = imagesByVariant.get(v.id) ?? [];
        // Variant's own images → shared product shots → every image, so a
        // colour always resolves to a non-empty gallery when any exist.
        const images = own.length ? own : sharedImages.length ? sharedImages : allImages;
        return {
          name: v.color,
          hex: v.colorHex,
          stock: v.stockQty,
          images,
        };
      }),
      reviews,
      reviewDist: buildReviewDist(reviewRows.map((r) => r.rating)),
      related,
    });

    res.json(pdp);
  })
);

export default router;

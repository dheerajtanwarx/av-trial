import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber } from "../lib/money";
import { requireAdmin } from "../middleware/authMiddleware";
import { Prisma } from "../../generated/prisma/client";

const router = Router();

// All product admin routes require an ADMIN session.
router.use(asyncHandler(requireAdmin));

/* ---------- helpers ---------- */

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A slug unique across products (ignoring `excludeId` when editing). */
async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  const root = slugify(base) || "product";
  let slug = root;
  let n = 1;
  // Loop is bounded in practice; each iteration tries the next suffix.
  while (true) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type ParsedVariant = {
  id?: number;
  color: string;
  colorHex: string;
  price: number;
  stockQty: number;
  sku: string;
};

type ParsedProduct = {
  name: string;
  slug?: string;
  categoryId: number;
  type: string | null;
  description: string | null;
  basePrice: number;
  comparePrice: number | null;
  badge: string | null;
  isBestseller: boolean;
  isActive: boolean;
  sizes: string[] | null;
  variants: ParsedVariant[];
  images: { imageUrl: string; isPrimary: boolean; sortOrder: number }[];
};

/** Validate + normalise a create/update body. Returns either field errors or
    the clean parsed product. Shared by POST and PUT. */
async function parseProductBody(
  body: any
): Promise<{ errors: Record<string, string> } | { data: ParsedProduct }> {
  const errors: Record<string, string> = {};

  const name = String(body?.name ?? "").trim();
  if (!name) errors.name = "Name is required.";

  const categoryId = Number(body?.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    errors.categoryId = "Choose a category.";
  } else {
    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) errors.categoryId = "Selected category no longer exists.";
  }

  const basePrice = Number(body?.basePrice);
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    errors.basePrice = "Enter a price greater than 0.";
  }

  let comparePrice: number | null = null;
  if (body?.comparePrice !== undefined && body?.comparePrice !== null && String(body.comparePrice).trim() !== "") {
    const cp = Number(body.comparePrice);
    if (!Number.isFinite(cp) || cp < 0) {
      errors.comparePrice = "Compare-at price must be 0 or more.";
    } else if (Number.isFinite(basePrice) && cp > 0 && cp <= basePrice) {
      errors.comparePrice = "Compare-at price should be higher than the price.";
    } else {
      comparePrice = cp;
    }
  }

  // Variants — optional, but each provided one is validated and SKUs must be
  // unique within the payload.
  const rawVariants: any[] = Array.isArray(body?.variants) ? body.variants : [];
  const variants: ParsedVariant[] = [];
  const seenSku = new Set<string>();
  rawVariants.forEach((v, i) => {
    const color = String(v?.color ?? "").trim();
    const colorHex = String(v?.colorHex ?? "").trim();
    const price = Number(v?.price);
    const stockQty = Number(v?.stockQty);
    const sku = String(v?.sku ?? "").trim();
    if (!color) errors[`variant.${i}.color`] = "Colour name required.";
    if (!HEX_RE.test(colorHex)) errors[`variant.${i}.colorHex`] = "Use a #RRGGBB hex.";
    if (!Number.isFinite(price) || price <= 0) errors[`variant.${i}.price`] = "Price must be > 0.";
    if (!Number.isInteger(stockQty) || stockQty < 0) errors[`variant.${i}.stockQty`] = "Stock must be 0 or more.";
    if (!sku) errors[`variant.${i}.sku`] = "SKU required.";
    else if (seenSku.has(sku.toLowerCase())) errors[`variant.${i}.sku`] = "Duplicate SKU.";
    seenSku.add(sku.toLowerCase());
    const id = Number(v?.id);
    variants.push({
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      color,
      colorHex,
      price,
      stockQty,
      sku,
    });
  });

  // Images — array of { imageUrl } or plain url strings. First image is primary.
  const rawImages: any[] = Array.isArray(body?.images) ? body.images : [];
  const images = rawImages
    .map((im: any) => (typeof im === "string" ? im : String(im?.imageUrl ?? "")).trim())
    .filter((url: string) => url.length > 0)
    .map((imageUrl: string, i: number) => ({ imageUrl, isPrimary: i === 0, sortOrder: i }));

  let sizes: string[] | null = null;
  if (Array.isArray(body?.sizes)) {
    sizes = body.sizes.map((s: any) => String(s).trim()).filter(Boolean);
    if (sizes && sizes.length === 0) sizes = null;
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    data: {
      name,
      slug: body?.slug ? slugify(String(body.slug)) : undefined,
      categoryId,
      type: body?.type ? String(body.type).trim() : null,
      description: body?.description ? String(body.description).trim() : null,
      basePrice,
      comparePrice,
      badge: body?.badge ? String(body.badge).trim() : null,
      isBestseller: Boolean(body?.isBestseller),
      isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
      sizes,
      variants,
      images,
    },
  };
}

const detailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  variants: { orderBy: { id: "asc" as const } },
  images: { orderBy: { sortOrder: "asc" as const } },
};

function serializeDetail(p: any) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    description: p.description,
    basePrice: toNumber(p.basePrice),
    comparePrice: p.comparePrice == null ? null : toNumber(p.comparePrice),
    badge: p.badge,
    rating: p.rating,
    reviewCount: p.reviewCount,
    isBestseller: p.isBestseller,
    isActive: p.isActive,
    sizes: Array.isArray(p.sizes) ? p.sizes : [],
    categoryId: p.categoryId,
    category: p.category,
    variants: p.variants.map((v: any) => ({
      id: v.id,
      color: v.color,
      colorHex: v.colorHex,
      price: toNumber(v.price),
      stockQty: v.stockQty,
      sku: v.sku,
    })),
    images: p.images.map((im: any) => ({
      id: im.id,
      imageUrl: im.imageUrl,
      isPrimary: im.isPrimary,
      sortOrder: im.sortOrder,
    })),
  };
}

/* GET /api/admin/products — list with search, status filter, pagination. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    const statusRaw = String(req.query.status ?? "all").toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));

    const where: Prisma.ProductWhereInput = {};
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { slug: { contains: q } },
        { type: { contains: q } },
      ];
    }
    if (statusRaw === "active") where.isActive = true;
    else if (statusRaw === "inactive") where.isActive = false;

    const [total, rows, activeCount, inactiveCount] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          images: {
            select: { imageUrl: true },
            orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
            take: 1,
          },
          variants: { select: { stockQty: true } },
        },
      }),
      prisma.product.count({ where: { ...where, isActive: true } }),
      prisma.product.count({ where: { ...where, isActive: false } }),
    ]);

    res.json({
      products: rows.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        type: p.type,
        price: toNumber(p.basePrice),
        comparePrice: p.comparePrice == null ? null : toNumber(p.comparePrice),
        category: p.category,
        image: p.images[0]?.imageUrl ?? null,
        stock: p.variants.reduce((s, v) => s + v.stockQty, 0),
        variantCount: p.variants.length,
        isActive: p.isActive,
      })),
      counts: {
        all: q ? total : await prisma.product.count(),
        active: activeCount,
        inactive: inactiveCount,
      },
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/* GET /api/admin/products/:id — full product for editing. */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid product id" });
      return;
    }
    const product = await prisma.product.findUnique({ where: { id }, include: detailInclude });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(serializeDetail(product));
  })
);

/* POST /api/admin/products — create. */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = await parseProductBody(req.body);
    if ("errors" in parsed) {
      res.status(400).json({ error: "Please fix the highlighted fields.", fields: parsed.errors });
      return;
    }
    const d = parsed.data;
    const slug = await uniqueSlug(d.slug ?? d.name);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: d.name,
            slug,
            categoryId: d.categoryId,
            type: d.type,
            description: d.description,
            basePrice: d.basePrice,
            comparePrice: d.comparePrice,
            badge: d.badge,
            isBestseller: d.isBestseller,
            isActive: d.isActive,
            sizes: d.sizes ?? Prisma.JsonNull,
          },
        });
        if (d.variants.length > 0) {
          await tx.productVariant.createMany({
            data: d.variants.map((v) => ({
              productId: product.id,
              color: v.color,
              colorHex: v.colorHex,
              price: v.price,
              stockQty: v.stockQty,
              sku: v.sku,
            })),
          });
        }
        if (d.images.length > 0) {
          await tx.productImage.createMany({
            data: d.images.map((im) => ({
              productId: product.id,
              imageUrl: im.imageUrl,
              isPrimary: im.isPrimary,
              sortOrder: im.sortOrder,
            })),
          });
        }
        return product;
      });

      const full = await prisma.product.findUnique({ where: { id: created.id }, include: detailInclude });
      res.status(201).json(serializeDetail(full));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "A SKU on one of the variants is already in use." });
        return;
      }
      throw err;
    }
  })
);

/* PUT /api/admin/products/:id — update fields, variants and images. */
router.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid product id" });
      return;
    }
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const parsed = await parseProductBody(req.body);
    if ("errors" in parsed) {
      res.status(400).json({ error: "Please fix the highlighted fields.", fields: parsed.errors });
      return;
    }
    const d = parsed.data;
    const slug = await uniqueSlug(d.slug ?? d.name, id);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            name: d.name,
            slug,
            categoryId: d.categoryId,
            type: d.type,
            description: d.description,
            basePrice: d.basePrice,
            comparePrice: d.comparePrice,
            badge: d.badge,
            isBestseller: d.isBestseller,
            isActive: d.isActive,
            sizes: d.sizes ?? Prisma.JsonNull,
          },
        });

        const current = await tx.productVariant.findMany({
          where: { productId: id },
          select: { id: true },
        });
        const incomingIds = new Set(d.variants.filter((v) => v.id).map((v) => v.id));

        // Remove variants the admin dropped — but only when no order references
        // them (OrderItem→variant is RESTRICT). Referenced ones are left intact.
        for (const cur of current) {
          if (!incomingIds.has(cur.id)) {
            const used = await tx.orderItem.count({ where: { variantId: cur.id } });
            if (used === 0) {
              await tx.productImage.updateMany({ where: { variantId: cur.id }, data: { variantId: null } });
              await tx.productVariant.delete({ where: { id: cur.id } });
            }
          }
        }

        // Upsert incoming variants.
        for (const v of d.variants) {
          if (v.id && current.some((c) => c.id === v.id)) {
            await tx.productVariant.update({
              where: { id: v.id },
              data: { color: v.color, colorHex: v.colorHex, price: v.price, stockQty: v.stockQty, sku: v.sku },
            });
          } else {
            await tx.productVariant.create({
              data: {
                productId: id,
                color: v.color,
                colorHex: v.colorHex,
                price: v.price,
                stockQty: v.stockQty,
                sku: v.sku,
              },
            });
          }
        }

        // Replace the product-level image gallery.
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (d.images.length > 0) {
          await tx.productImage.createMany({
            data: d.images.map((im) => ({
              productId: id,
              imageUrl: im.imageUrl,
              isPrimary: im.isPrimary,
              sortOrder: im.sortOrder,
            })),
          });
        }
      });

      const full = await prisma.product.findUnique({ where: { id }, include: detailInclude });
      res.json(serializeDetail(full));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "A SKU on one of the variants is already in use." });
        return;
      }
      throw err;
    }
  })
);

/* DELETE /api/admin/products/:id — hard delete when safe; products with order
   history can't be deleted (FK RESTRICT) so we block with a clear message. */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid product id" });
      return;
    }
    const product = await prisma.product.findUnique({ where: { id }, include: { variants: { select: { id: true } } } });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const variantIds = product.variants.map((v) => v.id);
    const orderRefs = variantIds.length
      ? await prisma.orderItem.count({ where: { variantId: { in: variantIds } } })
      : 0;
    if (orderRefs > 0) {
      res.status(409).json({
        error:
          "This product appears in existing orders and can't be deleted. Set it to Inactive instead to hide it from the store.",
        code: "HAS_ORDERS",
      });
      return;
    }

    try {
      // Cascade removes variants, images, cart items and wishlist entries.
      await prisma.product.delete({ where: { id } });
      res.json({ ok: true, id });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        res.status(409).json({
          error: "This product is referenced elsewhere and can't be deleted. Set it to Inactive instead.",
          code: "HAS_REFS",
        });
        return;
      }
      throw err;
    }
  })
);

export default router;

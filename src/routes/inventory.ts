import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber } from "../lib/money";
import { requireAdmin } from "../middleware/authMiddleware";
import { Prisma } from "../../generated/prisma/client";

const router = Router();

// Every inventory route requires an ADMIN session.
router.use(asyncHandler(requireAdmin));

/** A variant holding this many units or fewer (but more than zero) is "low".
    Lines up with the products table's low-stock colour cue so the two admin
    views agree. Exported so the threshold lives in exactly one place. */
export const LOW_STOCK_THRESHOLD = 10;

type StockStatus = "out" | "low" | "ok";

function stockStatus(stockQty: number): StockStatus {
  if (stockQty <= 0) return "out";
  if (stockQty <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

/** The status filters the inventory list understands (plus "all"). */
const FILTERS = ["all", "ok", "low", "out"] as const;
type InventoryFilter = (typeof FILTERS)[number];

/** Translate a status filter into a stockQty constraint. "all" adds nothing. */
function stockWhere(status: InventoryFilter): Prisma.ProductVariantWhereInput {
  switch (status) {
    case "out":
      return { stockQty: { lte: 0 } };
    case "low":
      return { stockQty: { gt: 0, lte: LOW_STOCK_THRESHOLD } };
    case "ok":
      return { stockQty: { gt: LOW_STOCK_THRESHOLD } };
    default:
      return {};
  }
}

const rowInclude = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      images: {
        select: { imageUrl: true },
        orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }],
        take: 1,
      },
    },
  },
};

function serializeRow(v: any) {
  return {
    variantId: v.id,
    productId: v.product.id,
    productName: v.product.name,
    slug: v.product.slug,
    productActive: v.product.isActive,
    color: v.color,
    colorHex: v.colorHex,
    sku: v.sku,
    price: toNumber(v.price),
    stockQty: v.stockQty,
    image: v.product.images[0]?.imageUrl ?? null,
    status: stockStatus(v.stockQty),
  };
}

/* GET /api/admin/inventory — paginated variant stock list with search + status
   filter. Query: q (product name / slug / colour / SKU), status (all | ok | low
   | out), page, pageSize. Returns rows ordered lowest-stock-first (so problems
   surface), per-status counts for the filter chips, and a summary block (total
   units + low/out tallies) for the stat cards. Counts/summary honour the search
   but not the status filter — same pattern as the orders list. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    const statusRaw = String(req.query.status ?? "all").toLowerCase();
    const status: InventoryFilter = FILTERS.includes(statusRaw as InventoryFilter)
      ? (statusRaw as InventoryFilter)
      : "all";

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 12));

    // Search filter (applied to the list, the chip counts and the summary).
    const searchWhere: Prisma.ProductVariantWhereInput = {};
    if (q) {
      searchWhere.OR = [
        { sku: { contains: q } },
        { color: { contains: q } },
        { product: { name: { contains: q } } },
        { product: { slug: { contains: q } } },
      ];
    }

    const where: Prisma.ProductVariantWhereInput = {
      AND: [searchWhere, stockWhere(status)],
    };

    const [total, rows, cAll, cOk, cLow, cOut, unitsAgg] = await Promise.all([
      prisma.productVariant.count({ where }),
      prisma.productVariant.findMany({
        where,
        include: rowInclude,
        // Lowest stock first so out-of-stock / low rows sit at the top.
        orderBy: [{ stockQty: "asc" }, { product: { name: "asc" } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.productVariant.count({ where: searchWhere }),
      prisma.productVariant.count({ where: { AND: [searchWhere, stockWhere("ok")] } }),
      prisma.productVariant.count({ where: { AND: [searchWhere, stockWhere("low")] } }),
      prisma.productVariant.count({ where: { AND: [searchWhere, stockWhere("out")] } }),
      prisma.productVariant.aggregate({ where: searchWhere, _sum: { stockQty: true } }),
    ]);

    res.json({
      rows: rows.map(serializeRow),
      counts: { all: cAll, ok: cOk, low: cLow, out: cOut },
      summary: {
        totalUnits: unitsAgg._sum.stockQty ?? 0,
        totalVariants: cAll,
        lowStock: cLow,
        outOfStock: cOut,
      },
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/* PATCH /api/admin/inventory/:variantId — adjust a variant's stock.
   Body is one of:
     { stockQty: <int ≥ 0> }  — set the level to an absolute value, or
     { delta: <int> }         — add/subtract relative to the current level.
   A relative decrement is guarded so two concurrent edits can't drive stock
   negative; an absolute set is applied directly. Because stock lives on the
   variant — the same field the storefront, cart and product views read — the
   change is reflected everywhere immediately (no separate product sync needed).
   Returns the updated row plus the product's new total stock. */
router.patch(
  "/:variantId",
  asyncHandler(async (req: Request, res: Response) => {
    const variantId = Number(req.params.variantId);
    if (!Number.isInteger(variantId)) {
      res.status(400).json({ error: "Invalid variant id" });
      return;
    }

    const body = req.body ?? {};
    const hasAbsolute = body.stockQty !== undefined && body.stockQty !== null;
    const hasDelta = body.delta !== undefined && body.delta !== null;
    if (hasAbsolute === hasDelta) {
      res.status(400).json({ error: "Provide either stockQty (absolute) or delta (relative)." });
      return;
    }

    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }

    if (hasAbsolute) {
      const next = Number(body.stockQty);
      if (!Number.isInteger(next) || next < 0) {
        res.status(400).json({ error: "Stock must be a whole number of 0 or more." });
        return;
      }
      await prisma.productVariant.update({ where: { id: variantId }, data: { stockQty: next } });
    } else {
      const delta = Number(body.delta);
      if (!Number.isInteger(delta) || delta === 0) {
        res.status(400).json({ error: "Adjustment must be a non-zero whole number." });
        return;
      }
      // Guarded relative update: when removing stock, only matches while enough
      // remains, so concurrent edits can't push the level below zero.
      const guard: Prisma.ProductVariantWhereInput =
        delta < 0 ? { id: variantId, stockQty: { gte: -delta } } : { id: variantId };
      const updated = await prisma.productVariant.updateMany({
        where: guard,
        data: { stockQty: { increment: delta } },
      });
      if (updated.count === 0) {
        res.status(409).json({
          error: `Can't remove ${-delta} units — only ${variant.stockQty} in stock.`,
        });
        return;
      }
    }

    const [fresh, productAgg] = await Promise.all([
      prisma.productVariant.findUnique({ where: { id: variantId }, include: rowInclude }),
      prisma.productVariant.aggregate({
        where: { productId: variant.productId },
        _sum: { stockQty: true },
      }),
    ]);

    res.json({
      row: serializeRow(fresh),
      productStock: productAgg._sum.stockQty ?? 0,
    });
  })
);

export default router;

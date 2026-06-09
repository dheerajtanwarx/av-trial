import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";

const router = Router();

/* GET /api/categories — landing category tiles. */
router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const categories = await prisma.category.findMany({
      where: { parentId: null },
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isActive: true },
          take: 2,
          include: {
            images: {
              select: { imageUrl: true },
              orderBy: { sortOrder: "asc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { id: "asc" },
    });

    res.json(
      categories.map((c, i) => ({
        name: c.name,
        slug: c.slug,
        count: `${c._count.products} styles`,
        href: `/category/${c.slug}`,
        main: c.products[0]?.images[0]?.imageUrl ?? "",
        alt: c.products[1]?.images[0]?.imageUrl ?? c.products[0]?.images[0]?.imageUrl ?? "",
        featured: i === 0,
      }))
    );
  })
);

export default router;

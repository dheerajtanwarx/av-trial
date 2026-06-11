import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware";

const router = Router();

/* POST /api/reviews — { productId, rating, comment? }
   Allowed only if the user has a DELIVERED order containing the product.
   Reviews are auto-approved and visible immediately; admins can later hide
   an inappropriate review via the moderation endpoints below. */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const productId = Number(req.body?.productId);
    const rating = Number(req.body?.rating);
    const comment = req.body?.comment ? String(req.body.comment) : null;

    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: "productId is required" });
      return;
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating must be 1–5" });
      return;
    }

    // Find a delivered order from this user containing a variant of the product.
    const order = await prisma.order.findFirst({
      where: {
        userId,
        status: "DELIVERED",
        items: { some: { variant: { productId } } },
      },
      orderBy: { placedAt: "desc" },
    });
    if (!order) {
      res.status(403).json({
        error: "You can only review a product from a delivered order",
      });
      return;
    }

    const existing = await prisma.review.findUnique({
      where: { userId_productId_orderId: { userId, productId, orderId: order.id } },
    });
    if (existing) {
      res.status(409).json({ error: "You've already reviewed this order" });
      return;
    }

    const review = await prisma.review.create({
      data: { userId, productId, orderId: order.id, rating, comment, isApproved: true },
    });

    res.status(201).json({
      ok: true,
      id: review.id,
      isApproved: review.isApproved,
      message: "Thanks! Your review is now live.",
    });
  })
);

/* ───────────────────────── Admin moderation ─────────────────────────
   All routes below require an ADMIN user. Reviews are post-moderated:
   they go live on creation, and an admin can hide (reject) or restore
   (approve) any review here. */

/* GET /api/reviews/admin?status=visible|hidden|all  (default: all)
   Lists reviews with the reviewer and product joined in, newest first. */
router.get(
  "/admin",
  asyncHandler(requireAdmin),
  asyncHandler(async (req: Request, res: Response) => {
    const status = String(req.query.status ?? "all");
    const where =
      status === "visible"
        ? { isApproved: true }
        : status === "hidden"
        ? { isApproved: false }
        : {};

    const rows = await prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        product: { select: { id: true, name: true, slug: true } },
      },
    });

    const reviews = rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      isApproved: r.isApproved,
      createdAt: r.createdAt.toISOString(),
      author: r.user.name || r.user.email || `User #${r.user.id}`,
      product: { id: r.product.id, name: r.product.name, slug: r.product.slug },
    }));

    res.json({
      reviews,
      counts: {
        all: await prisma.review.count(),
        visible: await prisma.review.count({ where: { isApproved: true } }),
        hidden: await prisma.review.count({ where: { isApproved: false } }),
      },
    });
  })
);

/* PATCH /api/reviews/admin/:id  { action: "approve" | "reject" }
   approve → make the review visible; reject → hide it. */
router.patch(
  "/admin/:id",
  asyncHandler(requireAdmin),
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid review id" });
      return;
    }

    const action = String(req.body?.action);
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "action must be 'approve' or 'reject'" });
      return;
    }

    const existing = await prisma.review.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const review = await prisma.review.update({
      where: { id },
      data: { isApproved: action === "approve" },
    });

    res.json({ ok: true, id: review.id, isApproved: review.isApproved });
  })
);

export default router;

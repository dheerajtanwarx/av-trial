import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();
router.use(requireAuth);

/* POST /api/reviews — { productId, rating, comment? }
   Allowed only if the user has a DELIVERED order containing the product.
   New reviews start unapproved (await moderation). */
router.post(
  "/",
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
      data: { userId, productId, orderId: order.id, rating, comment, isApproved: false },
    });

    res.status(201).json({
      ok: true,
      id: review.id,
      isApproved: review.isApproved,
      message: "Thanks! Your review will appear once approved.",
    });
  })
);

export default router;

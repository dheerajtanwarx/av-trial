import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, isEmail } from "../lib/http";

const router = Router();

/* POST /api/newsletter — { email } -> { ok }. Idempotent upsert. */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) {
      res.status(400).json({ ok: false, error: "Enter a valid email" });
      return;
    }

    await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    res.json({ ok: true });
  })
);

export default router;

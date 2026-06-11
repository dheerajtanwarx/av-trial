import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";

const router = Router();

/* GET /api/settings/hero — public hero background overrides for the storefront
   carousel. Returns { images: (string | null)[] } aligned to slide index; an
   empty array means "use the built-in defaults". */
router.get(
  "/hero",
  asyncHandler(async (_req: Request, res: Response) => {
    const setting = await prisma.siteSetting.findUnique({ where: { key: "hero" } });
    const value = setting?.value as { images?: unknown } | null;
    const images = Array.isArray(value?.images)
      ? value!.images.map((u: unknown) => (typeof u === "string" && u.trim() ? u.trim() : null))
      : [];
    res.json({ images });
  })
);

export default router;

import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { toNumber } from "../lib/money";

const router = Router();

/* POST /api/promos/validate — { code, subtotal? } -> { ok, pct, label } | { ok:false, error } */
router.post(
  "/validate",
  asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.body?.code ?? "").trim().toUpperCase();
    const subtotal = Number(req.body?.subtotal ?? 0);

    if (!code) {
      res.status(400).json({ ok: false, error: "Enter a promo code" });
      return;
    }

    const promo = await prisma.promo.findUnique({ where: { code } });
    if (!promo || !promo.active) {
      res.json({ ok: false, error: "That code isn't valid" });
      return;
    }
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      res.json({ ok: false, error: "That code has expired" });
      return;
    }
    if (promo.minSpend && subtotal < toNumber(promo.minSpend)) {
      res.json({
        ok: false,
        error: `Spend ₹${toNumber(promo.minSpend)} to use this code`,
      });
      return;
    }

    res.json({ ok: true, pct: toNumber(promo.pct), label: promo.label });
  })
);

export default router;

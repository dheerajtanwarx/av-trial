import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();
router.use(requireAuth);

const FIELDS = ["fullName", "phone", "street", "city", "state", "pincode"] as const;

/* GET /api/addresses */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    res.json(addresses);
  })
);

/* POST /api/addresses */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const body = req.body ?? {};
    for (const f of FIELDS) {
      if (!body[f] || String(body[f]).trim() === "") {
        res.status(400).json({ error: `Missing field: ${f}` });
        return;
      }
    }
    const isDefault = Boolean(body.isDefault);
    if (isDefault) {
      await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    const address = await prisma.address.create({
      data: {
        userId,
        fullName: String(body.fullName),
        phone: String(body.phone),
        street: String(body.street),
        city: String(body.city),
        state: String(body.state),
        pincode: String(body.pincode),
        country: body.country ? String(body.country) : "India",
        isDefault,
      },
    });
    res.status(201).json(address);
  })
);

/* PATCH /api/addresses/:id */
router.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const id = Number(req.params.id);
    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    const body = req.body ?? {};
    if (body.isDefault) {
      await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    const data: Record<string, unknown> = {};
    for (const f of FIELDS) if (body[f] != null) data[f] = String(body[f]);
    if (body.country != null) data.country = String(body.country);
    if (body.isDefault != null) data.isDefault = Boolean(body.isDefault);

    const address = await prisma.address.update({ where: { id }, data });
    res.json(address);
  })
);

/* DELETE /api/addresses/:id */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const id = Number(req.params.id);
    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    await prisma.address.delete({ where: { id } });
    res.json({ ok: true });
  })
);

export default router;

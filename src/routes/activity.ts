import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAdmin } from "../middleware/authMiddleware";
import { toCsv, sendCsv } from "../lib/csv";
import { ActorType, Prisma } from "../../generated/prisma/client";

const router = Router();
router.use(asyncHandler(requireAdmin));

const ACTOR_TYPES = Object.values(ActorType);

/** Build the where clause shared by the list and the CSV export.
    Query params: action (exact, or prefix when it ends with ".", e.g.
    "order."), actorType, actorId, entityType, entityId, from, to (ISO). */
function buildWhere(req: Request): Prisma.ActivityLogWhereInput {
  const where: Prisma.ActivityLogWhereInput = {};

  const action = String(req.query.action ?? "").trim();
  if (action) {
    where.action = action.endsWith(".") ? { startsWith: action } : action;
  }

  const actorTypeRaw = String(req.query.actorType ?? "").toUpperCase();
  if (ACTOR_TYPES.includes(actorTypeRaw as ActorType)) {
    where.actorType = actorTypeRaw as ActorType;
  }
  const actorId = Number(req.query.actorId);
  if (Number.isInteger(actorId) && actorId > 0) where.actorId = actorId;

  const entityType = String(req.query.entityType ?? "").trim();
  if (entityType) where.entityType = entityType;
  const entityId = Number(req.query.entityId);
  if (Number.isInteger(entityId) && entityId > 0) where.entityId = entityId;

  const from = new Date(String(req.query.from ?? ""));
  const to = new Date(String(req.query.to ?? ""));
  if (!isNaN(from.getTime()) || !isNaN(to.getTime())) {
    where.createdAt = {
      ...(isNaN(from.getTime()) ? {} : { gte: from }),
      ...(isNaN(to.getTime()) ? {} : { lte: to }),
    };
  }

  return where;
}

/** Resolve actor display names for a page of rows (one query, not N). */
async function actorNames(rows: { actorType: ActorType; actorId: number | null }[]) {
  const ids = [
    ...new Set(
      rows
        .filter((r) => r.actorType !== "SYSTEM" && r.actorId != null)
        .map((r) => r.actorId as number)
    ),
  ];
  if (ids.length === 0) return new Map<number, string>();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email || `#${u.id}`]));
}

/* GET /api/admin/activity — paginated, filterable audit trail. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const where = buildWhere(req);

    const [total, rows] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const names = await actorNames(rows);

    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorType: r.actorType,
        actorId: r.actorId,
        actorName:
          r.actorType === "SYSTEM" ? "System" : names.get(r.actorId ?? -1) ?? null,
        entityType: r.entityType,
        entityId: r.entityId,
        meta: r.meta,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/** Hard cap on export size so a single request can't stream the whole table. */
const EXPORT_MAX_ROWS = 10_000;

/* GET /api/admin/activity/export — CSV of the filtered trail (same query
   params as the list), newest first, capped at EXPORT_MAX_ROWS. */
router.get(
  "/export",
  asyncHandler(async (req: Request, res: Response) => {
    const where = buildWhere(req);
    const rows = await prisma.activityLog.findMany({
      where,
      orderBy: { id: "desc" },
      take: EXPORT_MAX_ROWS,
    });
    const names = await actorNames(rows);

    const csv = toCsv(
      [
        "ID",
        "Timestamp (UTC)",
        "Action",
        "Actor Type",
        "Actor ID",
        "Actor",
        "Entity Type",
        "Entity ID",
        "Details",
        "IP",
        "User Agent",
      ],
      rows.map((r) => [
        r.id,
        r.createdAt.toISOString(),
        r.action,
        r.actorType,
        r.actorId,
        r.actorType === "SYSTEM" ? "System" : names.get(r.actorId ?? -1) ?? "",
        r.entityType,
        r.entityId,
        r.meta == null ? "" : JSON.stringify(r.meta),
        r.ip,
        r.userAgent,
      ])
    );
    sendCsv(res, `activity-log-${new Date().toISOString().slice(0, 10)}`, csv);
  })
);

export default router;

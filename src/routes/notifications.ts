import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAdmin } from "../middleware/authMiddleware";
import { ACTIONS, Action, logActivity, notifyTx } from "../lib/notify";
import { publish, RealtimeEventName } from "../lib/realtime";
import {
  NotificationPriority,
  NotificationType,
  Prisma,
} from "../../generated/prisma/client";

const router = Router();
router.use(asyncHandler(requireAdmin));

const TYPES = Object.values(NotificationType);
const PRIORITIES = Object.values(NotificationPriority);

const orderNo = (id: number) => "AVC-" + String(id).padStart(6, "0");

function serializeRow(r: {
  readAt: Date | null;
  archivedAt: Date | null;
  notification: {
    id: number;
    type: NotificationType;
    priority: NotificationPriority;
    title: string;
    body: string;
    orderId: number | null;
    meta: Prisma.JsonValue;
    createdAt: Date;
  };
}) {
  const n = r.notification;
  return {
    id: n.id,
    type: n.type,
    priority: n.priority,
    title: n.title,
    body: n.body,
    orderId: n.orderId,
    orderNo: n.orderId ? orderNo(n.orderId) : null,
    meta: n.meta,
    createdAt: n.createdAt,
    read: !!r.readAt,
    readAt: r.readAt,
    archived: !!r.archivedAt,
    archivedAt: r.archivedAt,
  };
}

/** The orderings the list endpoint understands. "priority" relies on MySQL
    sorting enums by definition order (CRITICAL < HIGH < MEDIUM < INFO);
    "unread" relies on MySQL putting NULLs first in ASC, so unread rows
    (readAt NULL) lead, newest first within the unread block. */
const SORTS: Record<string, Prisma.NotificationRecipientOrderByWithRelationInput[]> = {
  newest: [{ notification: { createdAt: "desc" } }, { notificationId: "desc" }],
  oldest: [{ notification: { createdAt: "asc" } }, { notificationId: "asc" }],
  priority: [{ notification: { priority: "asc" } }, { notificationId: "desc" }],
  unread: [{ readAt: "asc" }, { notificationId: "desc" }],
};

/* GET /api/admin/notifications — the signed-in admin's inbox.
   Query: q (search title/body), type, priority, unread=1 (unread only),
   archived=1 (archived view — default view excludes archived), from, to
   (ISO date range on createdAt), sort (newest | oldest | priority | unread),
   page, pageSize. Read items stay listed: history is permanent, "archived"
   just moves rows to the archived view. */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const q = String(req.query.q ?? "").trim();
    const typeRaw = String(req.query.type ?? "").toUpperCase();
    const prioRaw = String(req.query.priority ?? "").toUpperCase();
    const unreadOnly = ["1", "true"].includes(String(req.query.unread ?? ""));
    const archivedView = ["1", "true"].includes(String(req.query.archived ?? ""));
    const orderBy = SORTS[String(req.query.sort ?? "newest")] ?? SORTS.newest;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));

    const notifWhere: Prisma.NotificationWhereInput = {};
    if (TYPES.includes(typeRaw as NotificationType)) {
      notifWhere.type = typeRaw as NotificationType;
    }
    if (PRIORITIES.includes(prioRaw as NotificationPriority)) {
      notifWhere.priority = prioRaw as NotificationPriority;
    }
    if (q) {
      notifWhere.OR = [{ title: { contains: q } }, { body: { contains: q } }];
    }
    const from = new Date(String(req.query.from ?? ""));
    const to = new Date(String(req.query.to ?? ""));
    if (!isNaN(from.getTime()) || !isNaN(to.getTime())) {
      notifWhere.createdAt = {
        ...(isNaN(from.getTime()) ? {} : { gte: from }),
        ...(isNaN(to.getTime()) ? {} : { lte: to }),
      };
    }

    const where: Prisma.NotificationRecipientWhereInput = {
      userId,
      archivedAt: archivedView ? { not: null } : null,
      ...(unreadOnly ? { readAt: null } : {}),
      ...(Object.keys(notifWhere).length > 0 ? { notification: notifWhere } : {}),
    };

    const [total, unread, rows] = await Promise.all([
      prisma.notificationRecipient.count({ where }),
      prisma.notificationRecipient.count({
        where: { userId, archivedAt: null, readAt: null },
      }),
      prisma.notificationRecipient.findMany({
        where,
        include: { notification: true },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      notifications: rows.map(serializeRow),
      unread,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/* GET /api/admin/notifications/unread-count — cheap endpoint for the UI to
   poll (badge count). Archived rows don't count as unread. */
router.get(
  "/unread-count",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const unread = await prisma.notificationRecipient.count({
      where: { userId, archivedAt: null, readAt: null },
    });
    res.json({ unread });
  })
);

/** Start of the current calendar day in IST — the business operates in India,
    so "today" is the Indian day regardless of server timezone. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function startOfTodayIST(): Date {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  nowIst.setUTCHours(0, 0, 0, 0);
  return new Date(nowIst.getTime() - IST_OFFSET_MS);
}

/* GET /api/admin/notifications/stats — badge/header numbers for the signed-in
   admin. Five indexed counts run in parallel; critical/high exclude archived
   (they're attention counters), total and today span the full history. */
router.get(
  "/stats",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const [total, unread, critical, high, today] = await Promise.all([
      prisma.notificationRecipient.count({ where: { userId } }),
      prisma.notificationRecipient.count({
        where: { userId, archivedAt: null, readAt: null },
      }),
      prisma.notificationRecipient.count({
        where: { userId, archivedAt: null, notification: { priority: "CRITICAL" } },
      }),
      prisma.notificationRecipient.count({
        where: { userId, archivedAt: null, notification: { priority: "HIGH" } },
      }),
      prisma.notificationRecipient.count({
        where: { userId, notification: { createdAt: { gte: startOfTodayIST() } } },
      }),
    ]);
    res.json({ total, unread, critical, high, today });
  })
);

/** Most ids a single bulk action accepts — bounds the IN clause and the
    activity-log meta payload. */
const BULK_MAX = 500;

/** Factory for the three bulk endpoints (read / archive / unarchive).
    Body: { ids: number[] }. Scoped to the caller's own recipient rows; the
    state guard in the WHERE skips rows already in the target state, so
    re-sending is harmless and the audit trail records only real changes —
    one row per bulk call. The acting admin's other sessions get one targeted
    sync event. */
function bulkAction(
  field: "readAt" | "archivedAt",
  makeValue: () => Date | null,
  guard: null | { not: null },
  action: Action,
  event: RealtimeEventName
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!raw || raw.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" });
      return;
    }
    if (raw.length > BULK_MAX) {
      res.status(400).json({ error: `At most ${BULK_MAX} ids per request` });
      return;
    }
    const ids: number[] = [...new Set<number>(raw.map(Number))];
    if (!ids.every((n) => Number.isInteger(n) && n > 0)) {
      res.status(400).json({ error: "ids must be positive integers" });
      return;
    }

    const userId = Number(req.currentUser!.id);
    const updated = await notifyTx(async (tx) => {
      const u = await tx.notificationRecipient.updateMany({
        where: { userId, notificationId: { in: ids }, [field]: guard },
        data: { [field]: makeValue() },
      });
      if (u.count > 0) {
        await logActivity(tx, {
          action,
          actorType: "ADMIN",
          actorId: userId,
          entityType: "notification",
          meta: { count: u.count, notificationIds: ids },
          req,
        });
      }
      return u.count;
    });
    if (updated > 0) {
      publish({ event, data: { ids }, userIds: [userId] });
    }
    res.json({ updated });
  });
}

/* POST /api/admin/notifications/read — mark selected ids read. */
router.post(
  "/read",
  bulkAction("readAt", () => new Date(), null, ACTIONS.NOTIFICATION_READ_BULK, "notification:read_bulk")
);
/* POST /api/admin/notifications/archive — archive selected ids. */
router.post(
  "/archive",
  bulkAction("archivedAt", () => new Date(), null, ACTIONS.NOTIFICATION_ARCHIVED_BULK, "notification:archived_bulk")
);
/* POST /api/admin/notifications/unarchive — restore selected ids. */
router.post(
  "/unarchive",
  bulkAction("archivedAt", () => null, { not: null }, ACTIONS.NOTIFICATION_UNARCHIVED_BULK, "notification:unarchived_bulk")
);

/* POST /api/admin/notifications/read-all — mark every unread, non-archived
   notification read. Logged as a single read_all row with the count + ids. */
router.post(
  "/read-all",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const ids = await notifyTx(async (tx) => {
      const pending = await tx.notificationRecipient.findMany({
        where: { userId, archivedAt: null, readAt: null },
        select: { notificationId: true },
      });
      if (pending.length === 0) return [] as number[];
      const found = pending.map((p) => p.notificationId);
      await tx.notificationRecipient.updateMany({
        where: { userId, notificationId: { in: found }, readAt: null },
        data: { readAt: new Date() },
      });
      await logActivity(tx, {
        action: ACTIONS.NOTIFICATION_READ_ALL,
        actorType: "ADMIN",
        actorId: userId,
        entityType: "notification",
        meta: { count: found.length, notificationIds: found },
        req,
      });
      return found;
    });
    if (ids.length > 0) {
      publish({
        event: "notification:read_all",
        data: { count: ids.length, ids },
        userIds: [userId],
      });
    }
    res.json({ updated: ids.length });
  })
);

/** State-sync events pushed to the acting admin's *other* sessions so every
    open tab converges without a refresh. Keyed by the audit action. */
const SYNC_EVENTS: Partial<Record<Action, RealtimeEventName>> = {
  [ACTIONS.NOTIFICATION_READ]: "notification:read",
  [ACTIONS.NOTIFICATION_UNREAD]: "notification:unread",
  [ACTIONS.NOTIFICATION_ARCHIVED]: "notification:archived",
  [ACTIONS.NOTIFICATION_UNARCHIVED]: "notification:unarchived",
};

/** Shared handler for the four per-notification state toggles. Idempotent:
    re-applying the current state is a no-op (no update, no log row). */
function stateToggle(
  field: "readAt" | "archivedAt",
  value: () => Date | null,
  action: Action
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);
    const notificationId = Number(req.params.id);
    if (!Number.isInteger(notificationId)) {
      res.status(400).json({ error: "Invalid notification id" });
      return;
    }
    const row = await prisma.notificationRecipient.findUnique({
      where: { notificationId_userId: { notificationId, userId } },
      include: { notification: true },
    });
    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    const next = value();
    const alreadyApplied = (row[field] === null) === (next === null);
    if (alreadyApplied) {
      res.json(serializeRow(row));
      return;
    }

    const updated = await notifyTx(async (tx) => {
      // State-guarded write: the WHERE pins the previous state, so when two
      // sessions race the same toggle, exactly one matches — the loser is a
      // silent no-op and writes no duplicate audit row.
      const u = await tx.notificationRecipient.updateMany({
        where: {
          notificationId,
          userId,
          [field]: next === null ? { not: null } : null,
        },
        data: { [field]: next },
      });
      if (u.count === 0) return null;
      await logActivity(tx, {
        action,
        actorType: "ADMIN",
        actorId: userId,
        entityType: "notification",
        entityId: notificationId,
        req,
      });
      return tx.notificationRecipient.findUnique({
        where: { notificationId_userId: { notificationId, userId } },
        include: { notification: true },
      });
    });
    if (!updated) {
      // Lost the race — the other request already applied this exact state.
      const fresh = await prisma.notificationRecipient.findUnique({
        where: { notificationId_userId: { notificationId, userId } },
        include: { notification: true },
      });
      res.json(serializeRow(fresh ?? row));
      return;
    }
    const sync = SYNC_EVENTS[action];
    if (sync) {
      publish({ event: sync, data: { id: notificationId }, userIds: [userId] });
    }
    res.json(serializeRow(updated));
  });
}

router.patch("/:id/read", stateToggle("readAt", () => new Date(), ACTIONS.NOTIFICATION_READ));
router.patch("/:id/unread", stateToggle("readAt", () => null, ACTIONS.NOTIFICATION_UNREAD));
router.patch("/:id/archive", stateToggle("archivedAt", () => new Date(), ACTIONS.NOTIFICATION_ARCHIVED));
router.patch("/:id/unarchive", stateToggle("archivedAt", () => null, ACTIONS.NOTIFICATION_UNARCHIVED));

export default router;

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAdmin } from "../middleware/authMiddleware";
import {
  addClient,
  connectedUserIds,
  dropUsers,
  removeClient,
  writeEvent,
} from "../lib/realtime";

const router = Router();
router.use(asyncHandler(requireAdmin));

const orderNo = (id: number) => "AVC-" + String(id).padStart(6, "0");

/** Most missed notifications replayed on one reconnect. Anything older is
    still in the REST list; replay only has to cover a normal outage window. */
const REPLAY_MAX = 100;

/** requireAdmin re-checks the role on every request, but a stream is one
    request that lives for hours — so every open stream's user is re-checked
    on this interval and demoted users are disconnected. */
const ROLE_RECHECK_MS = 5 * 60_000;

const roleSweep = setInterval(async () => {
  const ids = connectedUserIds();
  if (ids.length === 0) return;
  try {
    const admins = await prisma.user.findMany({
      where: { id: { in: ids }, role: "ADMIN" },
      select: { id: true },
    });
    const stillAdmin = new Set(admins.map((a) => a.id));
    dropUsers(ids.filter((id) => !stillAdmin.has(id)));
  } catch {
    /* transient DB error — the next sweep re-checks */
  }
}, ROLE_RECHECK_MS);
roleSweep.unref();

/* GET /api/admin/realtime/stream — the admin SSE feed.

   Live events: notification:new (id-stamped with the notification id),
   notification state syncs, activity:new, dashboard:update. The browser's
   EventSource reconnects on its own and sends Last-Event-ID; we also accept
   ?lastEventId= for clients that recreate the EventSource manually (e.g.
   after an auth failure closed it). Missed notification:new events are
   replayed from the database — the DB is the source of truth, the stream is
   only a delivery hint, so a dropped connection can never lose data.

   The client is registered for live events *before* the replay query runs, so
   a notification created mid-replay is delivered either live or by the replay
   (possibly both, and possibly out of order) — never neither. The client
   dedupes by notification id. */
router.get(
  "/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = Number(req.currentUser!.id);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // Reconnect delay hint for the browser's native retry loop.
    res.write("retry: 5000\n\n");

    // requireAdmin already verified this token; decode only reads its expiry.
    const token = req.cookies?.["av_token"] as string | undefined;
    const exp = token ? (jwt.decode(token) as { exp?: number } | null)?.exp : undefined;
    const client = addClient(userId, res, exp ? exp * 1000 : null);
    req.on("close", () => removeClient(client));

    const lastRaw = req.get("last-event-id") ?? String(req.query.lastEventId ?? "");
    const last = Number(lastRaw);
    if (Number.isInteger(last) && last > 0) {
      const missed = await prisma.notificationRecipient.findMany({
        where: { userId, notificationId: { gt: last } },
        include: { notification: true },
        orderBy: { notificationId: "asc" },
        take: REPLAY_MAX,
      });
      try {
        for (const r of missed) {
          const n = r.notification;
          writeEvent(res, {
            event: "notification:new",
            id: n.id,
            data: {
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
              replayed: true,
            },
          });
        }
      } catch {
        // Socket died mid-replay; the close handler already removed the
        // client and the next reconnect replays from its Last-Event-ID.
      }
    }
  })
);

export default router;

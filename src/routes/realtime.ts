import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { requireAdmin } from "../middleware/authMiddleware";
import { addClient, removeClient, writeEvent } from "../lib/realtime";

const router = Router();
router.use(asyncHandler(requireAdmin));

const orderNo = (id: number) => "AVC-" + String(id).padStart(6, "0");

/** Most missed notifications replayed on one reconnect. Anything older is
    still in the REST list; replay only has to cover a normal outage window. */
const REPLAY_MAX = 100;

/* GET /api/admin/realtime/stream — the admin SSE feed.

   Live events: notification:new (id-stamped with the notification id),
   notification state syncs, activity:new, dashboard:update. The browser's
   EventSource reconnects on its own and sends Last-Event-ID; we also accept
   ?lastEventId= for clients that recreate the EventSource manually (e.g.
   after an auth failure closed it). Missed notification:new events are
   replayed from the database — the DB is the source of truth, the stream is
   only a delivery hint, so a dropped connection can never lose data. */
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

    const lastRaw = req.get("last-event-id") ?? String(req.query.lastEventId ?? "");
    const last = Number(lastRaw);
    if (Number.isInteger(last) && last > 0) {
      const missed = await prisma.notificationRecipient.findMany({
        where: { userId, notificationId: { gt: last } },
        include: { notification: true },
        orderBy: { notificationId: "asc" },
        take: REPLAY_MAX,
      });
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
    }

    const client = addClient(userId, res);
    req.on("close", () => removeClient(client));
  })
);

export default router;

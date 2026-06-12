// Seeds three "[api-smoke]" notifications for endpoint testing. Cleaned up by
// api-smoke-cleanup.ts — shared prod DB, so everything is tagged in the title.
import "dotenv/config";
import { prisma } from "./src/lib/prisma";
import { emitNotification } from "./src/lib/notify";

async function main() {
  const a = await prisma.$transaction(async (tx) =>
    emitNotification(tx, {
      type: "SYSTEM_ALERT",
      priority: "CRITICAL",
      title: "[api-smoke] critical ZEBRA alert",
      body: "smoke row",
      meta: { smoke: true },
    })
  );
  const b = await prisma.$transaction(async (tx) =>
    emitNotification(tx, {
      type: "NEW_ORDER",
      priority: "HIGH",
      title: "[api-smoke] high order row",
      body: "smoke row",
      meta: { smoke: true },
    })
  );
  const c = await prisma.$transaction(async (tx) =>
    emitNotification(tx, {
      type: "ORDER_STATUS_CHANGE",
      priority: "INFO",
      title: "[api-smoke] info backdated row",
      body: "smoke row",
      meta: { smoke: true },
    })
  );
  // Backdate the third to 10 days ago for date-range / oldest-sort checks.
  await prisma.notification.update({
    where: { id: c.id },
    data: { createdAt: new Date(Date.now() - 10 * 86_400_000) },
  });
  console.log(JSON.stringify({ ids: [a.id, b.id, c.id] }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

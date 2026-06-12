// Removes everything api-smoke-seed.ts created, plus the bulk-archive audit
// row the test produced.
import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  const rows = await prisma.notification.findMany({
    where: { title: { startsWith: "[api-smoke]" } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.notificationRecipient.deleteMany({ where: { notificationId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { id: { in: ids } } });
  const logs = await prisma.activityLog.deleteMany({
    where: { action: "notification.archived_bulk", actorId: 10 },
  });
  console.log(`cleaned ${ids.length} notifications, ${logs.count} audit rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

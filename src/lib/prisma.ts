import { PrismaClient } from "../../generated/prisma/client";

/* Set PRISMA_QUERY_LOG=1 to print every SQL statement with its engine-side
   duration — used for performance audits; off in normal operation. */
export const prisma = new PrismaClient(
  process.env.PRISMA_QUERY_LOG
    ? { log: [{ emit: "event", level: "query" }] }
    : undefined
);

if (process.env.PRISMA_QUERY_LOG) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$on("query", (e: { query: string; duration: number }) => {
    console.log(`[sql ${e.duration}ms] ${e.query}`);
  });
}

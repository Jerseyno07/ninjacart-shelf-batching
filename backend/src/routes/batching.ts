import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { assertHoldsLock } from "../services/lockGuard.js";
import { listFsnSummaries, listDarkstoresForFsn, submitBatch } from "../services/ledgerService.js";
import { getLatestCompletedBatchId } from "../services/ingestionService.js";
import { NotFoundError } from "../lib/errors.js";

const fsnParamSchema = z.object({ fsn: z.string().min(1) });
const submitBodySchema = z.object({
  submissions: z
    .array(
      z.object({
        darkstoreId: z.string().min(1),
        qtyBatched: z.number().int().positive(),
        clientRequestId: z.string().uuid(),
      })
    )
    .min(1, "Submit only sends touched rows — at least one is required"),
});

async function currentDemandBatchId(): Promise<string> {
  const id = await getLatestCompletedBatchId(pool);
  if (!id) {
    throw new NotFoundError("No completed demand batch to batch against yet");
  }
  return id;
}

export async function batchingRoutes(app: FastifyInstance): Promise<void> {
  // FSN list: total remaining qty across darkstores, per FSN.
  app.get("/api/v1/fsns", { preHandler: requireAuth }, async (_request, reply) => {
    const demandBatchId = await currentDemandBatchId();
    const fsns = await listFsnSummaries(pool, demandBatchId);
    return reply.send({ demandBatchId, fsns });
  });

  // Only reachable if the caller currently holds the FSN lock — see ADR-001.
  app.get("/api/v1/fsns/:fsn/darkstores", { preHandler: requireAuth }, async (request, reply) => {
    const { fsn } = fsnParamSchema.parse(request.params);
    await assertHoldsLock(pool, fsn, request.user.id);
    const demandBatchId = await currentDemandBatchId();
    const darkstores = await listDarkstoresForFsn(pool, demandBatchId, fsn);
    return reply.send({ demandBatchId, fsn, darkstores });
  });

  // Batched submit of only the touched rows within a locked FSN.
  app.post("/api/v1/fsns/:fsn/batch", { preHandler: requireAuth }, async (request, reply) => {
    const { fsn } = fsnParamSchema.parse(request.params);
    const { submissions } = submitBodySchema.parse(request.body);
    await assertHoldsLock(pool, fsn, request.user.id);
    const demandBatchId = await currentDemandBatchId();
    const results = await submitBatch(pool, demandBatchId, fsn, request.user.id, submissions);
    return reply.send({ results });
  });
}

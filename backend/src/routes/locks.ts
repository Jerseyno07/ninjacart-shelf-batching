import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { acquireLock, heartbeat, releaseLock, forceUnlock, listActiveLocks } from "../services/lockService.js";
import { LockConflictError } from "../lib/errors.js";

const fsnParamSchema = z.object({ fsn: z.string().min(1) });
const forceUnlockBodySchema = z.object({ reason: z.string().min(1) });

export async function lockRoutes(app: FastifyInstance): Promise<void> {
  // Acquiring the lock is the gate before the darkstore list is shown at all
  // — see docs/02-adr-001-fsn-level-locking.md.
  app.post("/api/v1/fsns/:fsn/lock", { preHandler: requireAuth }, async (request, reply) => {
    const { fsn } = fsnParamSchema.parse(request.params);
    try {
      const lock = await acquireLock(pool, fsn, request.user.id);
      return reply.send({ lock });
    } catch (err) {
      if (err instanceof LockConflictError) {
        return reply.status(409).send({ code: err.code, message: err.message, heldBy: err.heldBy });
      }
      throw err;
    }
  });

  app.post("/api/v1/fsns/:fsn/heartbeat", { preHandler: requireAuth }, async (request, reply) => {
    const { fsn } = fsnParamSchema.parse(request.params);
    const lock = await heartbeat(pool, fsn, request.user.id);
    return reply.send({ lock });
  });

  app.post("/api/v1/fsns/:fsn/release", { preHandler: requireAuth }, async (request, reply) => {
    const { fsn } = fsnParamSchema.parse(request.params);
    await releaseLock(pool, fsn, request.user.id);
    return reply.status(204).send();
  });

  app.post(
    "/api/v1/admin/fsns/:fsn/force-unlock",
    { preHandler: requireRole("supervisor", "admin") },
    async (request, reply) => {
      const { fsn } = fsnParamSchema.parse(request.params);
      const { reason } = forceUnlockBodySchema.parse(request.body);
      await forceUnlock(pool, fsn, request.user.id, reason);
      return reply.status(204).send();
    }
  );

  app.get(
    "/api/v1/admin/fsns/locks",
    { preHandler: requireRole("supervisor", "admin") },
    async (_request, reply) => {
      const locks = await listActiveLocks(pool);
      return reply.send({ locks });
    }
  );
}

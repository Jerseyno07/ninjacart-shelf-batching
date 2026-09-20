import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { createUser, listUsers, updateUser } from "../services/userService.js";
import { ingestUserBulkFile } from "../services/userBulkService.js";
import { getDashboardSummary, getDashboardMetrics } from "../services/dashboardService.js";
import { listDarkstoresForFsn } from "../services/ledgerService.js";
import { getLatestCompletedBatchId } from "../services/ingestionService.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";

const createUserSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["labour", "supervisor", "admin"]),
});

const updateUserSchema = z.object({
  active: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const fsnParamSchema = z.object({ fsn: z.string().min(1) });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // User management — admin-only (not supervisor: creating/deactivating
  // accounts is an admin responsibility per the kickoff spec, distinct
  // from a supervisor's monitoring/force-unlock role).
  app.post("/api/v1/admin/users", { preHandler: requireRole("admin") }, async (request, reply) => {
    const body = createUserSchema.parse(request.body);
    const user = await createUser(pool, body);
    return reply.status(201).send({ user });
  });

  app.get("/api/v1/admin/users", { preHandler: requireRole("admin") }, async (_request, reply) => {
    const users = await listUsers(pool);
    return reply.send({ users });
  });

  app.patch(
    "/api/v1/admin/users/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const body = updateUserSchema.parse(request.body);
      const user = await updateUser(pool, id, body);
      return reply.send({ user });
    }
  );

  app.post(
    "/api/v1/admin/users/bulk-upload",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw new ValidationError("No file uploaded — expected multipart field 'file'");
      }
      const buffer = await file.toBuffer();
      const result = await ingestUserBulkFile(pool, buffer);
      return reply.send(result);
    }
  );

  // Dashboard summary — admin + supervisor (monitoring is a supervisor task).
  app.get(
    "/api/v1/admin/dashboard/summary",
    { preHandler: requireRole("admin", "supervisor") },
    async (_request, reply) => {
      const summary = await getDashboardSummary(pool);
      return reply.send(summary);
    }
  );

  // Dashboard extended metrics — labour productivity, darkstore-level
  // completion, and FSN breakdown for the OPS-tracking dashboard view.
  app.get(
    "/api/v1/admin/dashboard/metrics",
    { preHandler: requireRole("admin", "supervisor") },
    async (_request, reply) => {
      const metrics = await getDashboardMetrics(pool);
      return reply.send(metrics);
    }
  );

  // Read-only FSN completion view — deliberately does NOT require holding
  // the FSN lock, unlike GET /api/v1/fsns/:fsn/darkstores. That lock-gated
  // endpoint is for labour actually working the FSN (docs/02-adr-001);
  // this one is for a supervisor watching progress without taking the lock.
  app.get(
    "/api/v1/admin/fsns/:fsn/darkstores",
    { preHandler: requireRole("admin", "supervisor") },
    async (request, reply) => {
      const { fsn } = fsnParamSchema.parse(request.params);
      const demandBatchId = await getLatestCompletedBatchId(pool);
      if (!demandBatchId) {
        throw new NotFoundError("No completed demand batch to report on yet");
      }
      const darkstores = await listDarkstoresForFsn(pool, demandBatchId, fsn);
      return reply.send({ demandBatchId, fsn, darkstores });
    }
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { ingestDemandFile } from "../services/ingestionService.js";
import { ValidationError } from "../lib/errors.js";

const batchIdParamSchema = z.object({ id: z.string().uuid() });

export async function ingestionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/admin/demand/upload",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw new ValidationError("No file uploaded — expected multipart field 'file'");
      }
      const buffer = await file.toBuffer();
      const result = await ingestDemandFile(pool, buffer, file.filename, request.user.id);
      return reply.send(result);
    }
  );

  app.get(
    "/api/v1/admin/demand/batches",
    { preHandler: requireRole("admin", "supervisor") },
    async (_request, reply) => {
      const result = await pool.query(
        `SELECT id, source_filename, status, total_rows, valid_rows, rejected_rows, created_at, completed_at
         FROM demand_batches ORDER BY created_at DESC LIMIT 50`
      );
      return reply.send({ batches: result.rows });
    }
  );

  app.get(
    "/api/v1/admin/demand/batches/:id/exceptions",
    { preHandler: requireRole("admin", "supervisor") },
    async (request, reply) => {
      const { id } = batchIdParamSchema.parse(request.params);
      const result = await pool.query(
        `SELECT row_number, raw_row, reason, created_at
         FROM demand_exceptions WHERE demand_batch_id = $1 ORDER BY row_number`,
        [id]
      );
      return reply.send({ exceptions: result.rows });
    }
  );
}

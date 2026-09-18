import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { login } from "../services/authService.js";
import { pool } from "../db/pool.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await login(pool, body.username, body.password);
    const token = app.jwt.sign(user, { expiresIn: "12h" });
    return reply.send({ token, user });
  });
}

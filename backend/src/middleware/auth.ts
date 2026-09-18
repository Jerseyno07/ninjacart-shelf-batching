import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError } from "../lib/errors.js";
import type { AuthenticatedUser } from "../services/authService.js";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await request.jwtVerify();
}

export function requireRole(...roles: Array<AuthenticatedUser["role"]>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await request.jwtVerify();
    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError(`Requires one of roles: ${roles.join(", ")}`);
    }
  };
}

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOCK_LEASE_MINUTES: z.coerce.number().int().positive().default(15),
  SENTRY_DSN: z.string().optional().default(""),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Comma-separated allowed origins for the labour app / admin panel, e.g.
  // "http://localhost:5173,http://localhost:5174". Required for any
  // browser-based client on a different origin than the API — without
  // this, every cross-origin request fails preflight (found the hard way
  // by actually running the labour app against this backend in a browser).
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),
});

export const config = envSchema.parse(process.env);

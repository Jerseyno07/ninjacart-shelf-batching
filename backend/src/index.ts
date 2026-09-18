import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import * as Sentry from "@sentry/node";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { lockRoutes } from "./routes/locks.js";
import { batchingRoutes } from "./routes/batching.js";
import { ingestionRoutes } from "./routes/ingestion.js";
import { adminRoutes } from "./routes/admin.js";
import { AppError } from "./lib/errors.js";
import "./types/auth.js";

if (config.SENTRY_DSN) {
  Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
}

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
  },
});

await app.register(fastifyCors, {
  origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
  // Explicit, not auto-detected: @fastify/cors's default method-detection
  // silently produced "GET,HEAD,POST" for this app (missing PATCH and
  // DELETE), which blocks every PATCH request's preflight in the browser
  // with no error surfaced anywhere except the network tab. Found by
  // actually clicking "Deactivate" in the admin panel.
  methods: ["GET", "POST", "PATCH", "DELETE"],
});
await app.register(fastifyJwt, { secret: config.JWT_SECRET });
await app.register(fastifyMultipart);

await app.register(authRoutes);
await app.register(lockRoutes);
await app.register(batchingRoutes);
await app.register(ingestionRoutes);
await app.register(adminRoutes);

app.get("/health", async () => ({ status: "ok" }));

app.setErrorHandler((err, request, reply) => {
  if (err instanceof AppError) {
    request.log.warn({ err, code: err.code }, "Handled application error");
    return reply.status(err.statusCode).send({ code: err.code, message: err.message });
  }

  request.log.error({ err }, "Unhandled error");
  if (config.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Something went wrong" });
});

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((address) => app.log.info(`Listening on ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

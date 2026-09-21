import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { AppError } from "../src/lib/errors.js";
import { MAX_UPLOAD_BYTES, FileTooLargeError, isFileTooLarge } from "../src/lib/uploadLimits.js";

async function buildApp() {
  const app = Fastify();
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  app.post("/upload", async (request) => {
    const file = await request.file();
    const buffer = await file!.toBuffer();
    return { bytes: buffer.length };
  });
  // Same mapping as the real error handler in src/index.ts.
  app.setErrorHandler((rawErr, _request, reply) => {
    const err = isFileTooLarge(rawErr) ? new FileTooLargeError() : rawErr;
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    return reply.status(500).send({ code: "INTERNAL_ERROR" });
  });
  return app;
}

function multipartBody(bytes: number) {
  const boundary = "----testboundary";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.csv"\r\nContent-Type: text/csv\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), Buffer.alloc(bytes, "a"), Buffer.from(tail)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("upload size limit", () => {
  it("is 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("accepts a file just under the limit (5 MB, more than the old 1 MB default)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/upload", ...multipartBody(5 * 1024 * 1024) });
    expect(res.statusCode).toBe(200);
    expect(res.json().bytes).toBe(5 * 1024 * 1024);
  });

  it("rejects a file over the limit with a clear 413, not a generic 500", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/upload", ...multipartBody(MAX_UPLOAD_BYTES + 1024) });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("FILE_TOO_LARGE");
    expect(res.json().message).toContain("10 MB");
  });
});

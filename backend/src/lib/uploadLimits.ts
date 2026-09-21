import { AppError } from "./errors.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class FileTooLargeError extends AppError {
  constructor() {
    super(`File is too large — the maximum upload size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`, 413, "FILE_TOO_LARGE");
  }
}

export function isFileTooLarge(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "FST_REQ_FILE_TOO_LARGE";
}

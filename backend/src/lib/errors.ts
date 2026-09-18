export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class LockConflictError extends AppError {
  constructor(
    message: string,
    public heldBy: { labourId: string; labourName: string; expiresAt: string }
  ) {
    super(message, 409, "LOCK_HELD");
  }
}

export class InsufficientRemainingError extends AppError {
  constructor(message: string) {
    super(message, 409, "INSUFFICIENT_REMAINING");
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

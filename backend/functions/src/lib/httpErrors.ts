import type { Response } from "express";
import { ZodError } from "zod";
type HttpErrorCode = "bad-request" | "unauthorized" | "forbidden" | "not-found" | "conflict";
const HTTP_STATUS_BY_CODE: Record<HttpErrorCode, number> = {
    "bad-request": 400,
    unauthorized: 401,
    forbidden: 403,
    "not-found": 404,
    conflict: 409,
};
export class HttpError extends Error {
    readonly code: HttpErrorCode;
    readonly details?: unknown;
    constructor(code: HttpErrorCode, message: string, details?: unknown) {
        super(message);
        this.name = "HttpError";
        this.code = code;
        this.details = details;
    }
    get status(): number {
        return HTTP_STATUS_BY_CODE[this.code];
    }
}
export class BadRequestError extends HttpError {
    constructor(message: string, details?: unknown) {
        super("bad-request", message, details);
        this.name = "BadRequestError";
    }
}
export class UnauthorizedError extends HttpError {
    constructor(message = "Unauthorized", details?: unknown) {
        super("unauthorized", message, details);
        this.name = "UnauthorizedError";
    }
}
export class ForbiddenError extends HttpError {
    constructor(message = "Forbidden", details?: unknown) {
        super("forbidden", message, details);
        this.name = "ForbiddenError";
    }
}
export class NotFoundError extends HttpError {
    constructor(message: string, details?: unknown) {
        super("not-found", message, details);
        this.name = "NotFoundError";
    }
}
export class ConflictError extends HttpError {
    constructor(message: string, details?: unknown) {
        super("conflict", message, details);
        this.name = "ConflictError";
    }
}
function getErrorResponse(error: unknown): {
    status: number;
    message: string;
    details?: unknown;
    expected: boolean;
} {
    if (error instanceof HttpError) {
        return {
            status: error.status,
            message: error.message,
            details: error.details,
            expected: true,
        };
    }
    if (error instanceof ZodError) {
        return {
            status: 400,
            message: "Invalid request payload",
            details: error.flatten(),
            expected: true,
        };
    }
    // Unexpected (non-HttpError, non-Zod) errors are never shown to the
    // client — the raw message can carry internal details from Plaid,
    // Stripe, Firestore, or AWS SDK errors (institution ids, doc paths,
    // library internals). Full detail still goes to the server log below;
    // the client only ever sees a generic message for a 500.
    return {
        status: 500,
        message: "Internal server error",
        expected: false,
    };
}
export function sendHttpError(res: Response, error: unknown, context: string): void {
    const response = getErrorResponse(error);
    if (response.expected) {
        console.warn(`${context}: ${response.message}`, response.details ?? "");
    }
    else {
        console.error(`${context}: unexpected error`, error);
    }
    res.status(response.status).json({
        ok: false,
        error: response.message,
        ...(response.details !== undefined ? { details: response.details } : {}),
    });
}

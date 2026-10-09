import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./types.ts";

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal_error";

export function errorBody(code: ErrorCode, message: string, requestId?: string): { error: { code: ErrorCode; message: string; requestId?: string } } {
  return { error: requestId ? { code, message, requestId } : { code, message } };
}

export class ApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503;

  constructor(status: ApiError["status"], code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  readonly code: ErrorCode;
}

export const badRequest = (message: string): ApiError => new ApiError(400, "invalid_request", message);
export const unauthorized = (message = "missing or invalid credentials"): ApiError =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "not allowed"): ApiError => new ApiError(403, "forbidden", message);
export const notFound = (message = "not found"): ApiError => new ApiError(404, "not_found", message);
export const conflict = (message: string): ApiError => new ApiError(409, "conflict", message);
export const unavailable = (message: string): ApiError => new ApiError(503, "unavailable", message);

export function respondWithError(
  c: Context<AppEnv>,
  error: unknown,
  log: { error: (message: string, context?: Record<string, unknown>) => void; debug: (message: string, context?: Record<string, unknown>) => void },
): Response {
  const requestId = c.get("requestId");

  if (error instanceof ApiError) {
    if (error.status >= 500) {
      log.error("request failed", { requestId, path: c.req.path, code: error.code, cause: error.message });
    } else {
      log.debug("request rejected", { requestId, path: c.req.path, code: error.code, cause: error.message });
    }
    return c.json(errorBody(error.code, error.message, requestId), error.status);
  }

  if (error instanceof HTTPException) {
    return c.json(errorBody("invalid_request", error.message || "invalid request", requestId), error.status);
  }

  const cause = error instanceof Error ? error.message : String(error);
  log.error("unhandled request failure", { requestId, path: c.req.path, cause });
  return c.json(errorBody("internal_error", "internal error", requestId), 500);
}
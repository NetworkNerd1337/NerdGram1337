import type { Response } from "express";

export function httpError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err && typeof err === "object") {
    const errno = "code" in err ? String((err as { code: unknown }).code) : "";
    const explicit =
      "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : undefined;
    const message = err instanceof Error ? err.message : "Unknown error";
    const details =
      "details" in err &&
      (err as { details?: unknown }).details &&
      typeof (err as { details?: unknown }).details === "object"
        ? (err as { details: Record<string, unknown> }).details
        : undefined;
    const appCode =
      typeof (err as { code?: unknown }).code === "string" &&
      !/^[A-Z0-9]+$/.test(String((err as { code?: unknown }).code))
        ? String((err as { code?: unknown }).code)
        : undefined;

    let status = explicit ?? 500;
    let errorMessage = message;
    if (explicit === undefined) {
      if (errno === "ENOENT" || message.includes("ENOENT")) {
        status = 404;
        errorMessage = "Not found";
      } else if (message.includes("escapes") || message.includes("Invalid")) {
        status = 400;
      }
    }

    const body: Record<string, unknown> = { error: errorMessage };
    if (appCode) body.code = appCode;
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        if (key !== "error" && key !== "status" && key !== "code") body[key] = value;
      }
    }
    return { status, body };
  }
  return { status: 500, body: { error: "Unknown error" } };
}

export function sendError(res: Response, err: unknown): void {
  const { status, body } = httpError(err);
  res.status(status).json(body);
}

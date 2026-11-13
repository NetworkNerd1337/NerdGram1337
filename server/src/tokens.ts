import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { getMetaPath } from "./paths.js";
import { httpFail } from "./storage.js";
import { sendError } from "./httpError.js";
import { writePrivateFile } from "./sync/layout.js";
import fs from "node:fs/promises";

/**
 * Automation tokens for `/api/v1`.
 *
 * The browser UI does not use these. Settings creates them on the loopback
 * API, the same way it saves other local preferences. The file stores a
 * SHA-256 hash, never the token. The plaintext is returned once, from the
 * create call. A revoked token stays in the file so a later presentation of
 * the same secret still fails.
 */

export const TOKEN_SCOPES = ["read", "read-write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

const MAX_TOKENS = 50;
const TOKEN_BYTES = 32;

export type PublicToken = {
  id: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type StoredToken = PublicToken & { hash: string };

type TokenFile = { version: 1; tokens: StoredToken[] };

const DUMMY_HASH = createHash("sha256").update("nerdgram-dummy-token", "utf8").digest();

export function tokenFilePath(): string {
  return path.join(getMetaPath(), "api-tokens.json");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Constant-time compare of two SHA-256 digests. Different lengths never match. */
export function hashesEqual(actual: Buffer, expected: Buffer): boolean {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function normalizeScope(value: unknown): TokenScope {
  if (value === "read") return "read";
  if (value === "write" || value === "read-write") return "read-write";
  throw httpFail(400, "scope must be read or read-write", "invalid");
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw httpFail(400, "name is required", "invalid");
  const name = value.trim();
  if (name.length < 1 || name.length > 60) throw httpFail(400, "name must be 1 to 60 characters", "invalid");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw httpFail(400, "name has a control character", "invalid");
  return name;
}

async function readFile(): Promise<TokenFile> {
  try {
    const raw = await fs.readFile(tokenFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<TokenFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tokens)) {
      return { version: 1, tokens: [] };
    }
    return { version: 1, tokens: parsed.tokens.filter(isStoredToken) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { version: 1, tokens: [] };
    throw err;
  }
}

function isStoredToken(value: unknown): value is StoredToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<StoredToken>;
  return (
    typeof token.id === "string" &&
    typeof token.name === "string" &&
    typeof token.prefix === "string" &&
    (token.scope === "read" || token.scope === "read-write") &&
    typeof token.hash === "string" &&
    typeof token.createdAt === "string" &&
    (token.lastUsedAt === null || typeof token.lastUsedAt === "string") &&
    (token.revokedAt === null || typeof token.revokedAt === "string")
  );
}

async function writeFile(file: TokenFile): Promise<void> {
  await writePrivateFile(tokenFilePath(), `${JSON.stringify(file, null, 2)}\n`);
}

export function toPublic(token: StoredToken): PublicToken {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scope: token.scope,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}

export async function listTokens(): Promise<PublicToken[]> {
  const file = await readFile();
  return file.tokens.map(toPublic);
}

export async function createToken(input: { name: unknown; scope: unknown }): Promise<{ token: string; tokenMeta: PublicToken }> {
  const name = normalizeName(input.name);
  const scope = normalizeScope(input.scope);
  const file = await readFile();
  if (file.tokens.length >= MAX_TOKENS) {
    throw httpFail(400, `This workspace already has ${MAX_TOKENS} tokens. Revoked tokens still count.`, "invalid");
  }
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const token = `ng_${secret}`;
  const id = randomBytes(9).toString("hex");
  const stored: StoredToken = {
    id,
    name,
    prefix: token.slice(0, 11),
    scope,
    hash: hashToken(token).toString("hex"),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  file.tokens.push(stored);
  await writeFile(file);
  return { token, tokenMeta: toPublic(stored) };
}

export async function revokeToken(id: string): Promise<PublicToken> {
  if (!/^[a-f0-9]{18}$/.test(id)) throw httpFail(400, "Invalid id", "invalid");
  const file = await readFile();
  const token = file.tokens.find((item) => item.id === id);
  if (!token) throw httpFail(404, "Token not found", "not_found");
  if (!token.revokedAt) {
    token.revokedAt = new Date().toISOString();
    await writeFile(file);
  }
  return toPublic(token);
}

export type AuthenticatedToken = PublicToken;

/**
 * Hash the presented token and compare it with every stored hash, including
 * revoked tokens and a dummy digest, so the compare does not stop at the
 * first hit. A match that is revoked is still unauthorized.
 */
export async function authenticateToken(presented: string): Promise<AuthenticatedToken | null> {
  const actual = hashToken(presented);
  const file = await readFile();
  let matched: StoredToken | null = null;
  hashesEqual(actual, DUMMY_HASH);
  for (const token of file.tokens) {
    const expected = Buffer.from(token.hash, "hex");
    if (expected.length === actual.length && timingSafeEqual(actual, expected)) matched = token;
  }
  if (!matched || matched.revokedAt) return null;
  matched.lastUsedAt = new Date().toISOString();
  await writeFile(file);
  return toPublic(matched);
}

export function bearerValue(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  return match[1];
}

function jsonObject(req: Request, res: Response): boolean {
  if (req.body == null) {
    req.body = {};
    return true;
  }
  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "JSON object required", code: "invalid" });
    return false;
  }
  return true;
}

/** Settings routes. These stay on the UI guards and do not accept a bearer token as a substitute. */
export function registerTokenRoutes(app: Express): void {
  app.get("/api/tokens", async (_req, res) => {
    try {
      res.json({ tokens: await listTokens() });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/tokens", async (req, res) => {
    try {
      if (!jsonObject(req, res)) return;
      const created = await createToken({ name: req.body?.name, scope: req.body?.scope });
      res.status(201).json(created);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/tokens/:id", async (req, res) => {
    try {
      const revoked = await revokeToken(String(req.params.id || ""));
      res.json({ token: revoked });
    } catch (err) {
      sendError(res, err);
    }
  });
}

import type { NextFunction, Request, Response } from "express";
import cors from "cors";

export type RuntimeMode = "development" | "production";

/** Vite's dev server port. Not a fallback range — see NERDGRAM_CORS_ORIGINS. */
export const VITE_DEV_PORT = 5173;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

/**
 * Loopback names always accepted in the Host header.
 * `0.0.0.0` and `::` are bind addresses, not Host values browsers send.
 */
const BUILTIN_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];

export function inferRuntimeMode(moduleUrl = import.meta.url): RuntimeMode {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "development") return "development";
  // `tsx` runs the TypeScript entry; `npm start` runs compiled `dist/index.js`.
  return moduleUrl.endsWith(".ts") ? "development" : "production";
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Unset or blank HOST binds IPv4 and IPv6 loopback so `localhost` works
 * whether it resolves to 127.0.0.1 or ::1. An explicit HOST is used alone,
 * which is what a container needs for HOST=0.0.0.0.
 */
export function resolveBindHosts(hostEnv: string | undefined): string[] {
  const trimmed = hostEnv?.trim() ?? "";
  if (!trimmed) return ["127.0.0.1", "::1"];
  return [trimmed];
}

export function parseHostHeader(
  value: string,
): { hostname: string; port: string | null } | null {
  const host = value.trim().toLowerCase();
  if (!host || host.includes("/") || host.includes("\\") || /\s/.test(host)) {
    return null;
  }
  if (host.includes("\0") || host.includes("*")) return null;

  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end <= 1) return null;
    const hostname = host.slice(1, end);
    if (!hostname || hostname.includes("[") || hostname.includes("]")) return null;
    const rest = host.slice(end + 1);
    if (rest === "") return { hostname, port: null };
    if (!rest.startsWith(":")) return null;
    const port = rest.slice(1);
    if (!port) return null;
    return { hostname, port };
  }

  if (host === "::1" || host === "::") {
    return { hostname: host, port: null };
  }

  const firstColon = host.indexOf(":");
  const lastColon = host.lastIndexOf(":");
  if (firstColon !== -1 && firstColon !== lastColon) return null;
  if (firstColon === -1) return { hostname: host, port: null };

  const hostname = host.slice(0, firstColon);
  const port = host.slice(firstColon + 1);
  if (!hostname || !port) return null;
  return { hostname, port };
}

/** Hostname only. Accepts a bracketed IPv6 literal or `host:port`. */
export function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || /\s/.test(trimmed)) {
    return null;
  }
  return parseHostHeader(trimmed)?.hostname ?? null;
}

export function isLoopbackBindHost(host: string): boolean {
  const hostname = normalizeHostname(host);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

export function buildAllowedHostnames(
  bindHosts: readonly string[],
  extraHosts: readonly string[],
): Set<string> {
  const allowed = new Set<string>(BUILTIN_HOSTNAMES);
  for (const host of bindHosts) {
    if (!isLoopbackBindHost(host)) continue;
    const hostname = normalizeHostname(host);
    if (hostname) allowed.add(hostname);
  }
  for (const host of extraHosts) {
    const hostname = normalizeHostname(host);
    if (!hostname || hostname === "*" || hostname === "0.0.0.0" || hostname === "::") {
      continue;
    }
    allowed.add(hostname);
  }
  return allowed;
}

export function isAllowedHostHeader(
  hostHeader: string | undefined,
  allowedHostnames: ReadonlySet<string>,
  allowedPorts: ReadonlySet<string>,
): boolean {
  if (hostHeader == null) return false;
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  if (!allowedHostnames.has(parsed.hostname)) return false;
  if (parsed.port === null) return true;
  if (!/^[0-9]+$/.test(parsed.port)) return false;
  const portNum = Number(parsed.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return false;
  return allowedPorts.has(String(portNum));
}

export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return url.origin;
}

export function buildAllowedOrigins(options: {
  mode: RuntimeMode;
  port: number;
  extraOrigins?: readonly string[];
}): Set<string> {
  const origins = new Set<string>();
  const add = (host: string, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    origins.add(`http://${host}:${port}`);
  };

  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    add(host, options.port);
  }

  if (options.mode === "development") {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      add(host, VITE_DEV_PORT);
    }
  }

  for (const extra of options.extraOrigins ?? []) {
    const normalized = normalizeOrigin(extra);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

export function formatExposedBindWarning(listenAddresses: readonly string[]): string | null {
  const exposed = listenAddresses.filter((address) => !isLoopbackListenAddress(address));
  if (exposed.length === 0) return null;
  return [
    "********************************************************************************",
    `WARNING: NerdGram1337 is listening on ${exposed.join(", ")}, which is NOT loopback.`,
    "The browser API has NO authentication. Anyone who can reach this port can read,",
    "create, overwrite, and delete your diagrams. A bearer token on /api/v1 does not",
    "protect those browser routes.",
    "Exposing NerdGram1337 beyond this machine is UNSUPPORTED. Do not use this",
    "on a shared host, a LAN, or a NAS.",
    "Bare metal should leave HOST unset (loopback only). The only intended reason",
    "to set HOST=0.0.0.0 is inside a container whose published port is",
    "127.0.0.1:8787 on the host, not 0.0.0.0:8787.",
    "********************************************************************************",
  ].join("\n");
}

function isLoopbackListenAddress(address: string): boolean {
  const withoutScheme = address.replace(/^https?:\/\//, "");
  const hostname = parseHostHeader(withoutScheme)?.hostname;
  if (!hostname) return false;
  return isLoopbackBindHost(hostname);
}

export function formatListenUrl(address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function allowedPortsFor(req: Request, configuredPort: number): Set<string> {
  const ports = new Set<string>();
  if (Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535) {
    ports.add(String(configuredPort));
  }
  const socketPort = req.socket?.localPort;
  if (typeof socketPort === "number" && socketPort >= 1 && socketPort <= 65535) {
    ports.add(String(socketPort));
  }
  return ports;
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase();
  return mime === "application/json";
}

export function createHostGuard(options: {
  getPort: () => number;
  bindHosts: readonly string[];
  extraHosts: readonly string[];
}): (req: Request, res: Response, next: NextFunction) => void {
  const allowedHostnames = buildAllowedHostnames(options.bindHosts, options.extraHosts);
  return (req, res, next) => {
    const host = singleHeader(req.headers.host);
    if (!isAllowedHostHeader(host, allowedHostnames, allowedPortsFor(req, options.getPort()))) {
      res.status(403).json({ error: "Forbidden host" });
      return;
    }
    next();
  };
}

export function createDevCors(options: {
  getPort: () => number;
  extraOrigins: readonly string[];
}): ReturnType<typeof cors> {
  return cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }
      const allowed = buildAllowedOrigins({
        mode: "development",
        port: options.getPort(),
        extraOrigins: options.extraOrigins,
      });
      const normalized = normalizeOrigin(origin);
      callback(null, normalized != null && allowed.has(normalized));
    },
  });
}

/**
 * Browsers send Origin on state-changing fetches. A foreign Origin is rejected
 * even if Sec-Fetch-Site is spoofed by a non-browser client. Sec-Fetch-Site
 * `cross-site` is rejected unless that Origin is on the allow-list (the dev UI
 * calling the API directly). Missing both headers is allowed: curl and other
 * local tools do not send them, and they are already on loopback.
 */
export function createMutationGuard(options: {
  getPort: () => number;
  mode: RuntimeMode;
  extraOrigins: readonly string[];
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const allowed = buildAllowedOrigins({
      mode: options.mode,
      port: options.getPort(),
      extraOrigins: options.extraOrigins,
    });

    const originHeader = req.headers.origin;
    if (Array.isArray(originHeader)) {
      res.status(403).json({ error: "Forbidden origin" });
      return;
    }

    let originAllowed = false;
    if (typeof originHeader === "string" && originHeader.trim()) {
      const normalized = normalizeOrigin(originHeader);
      if (!normalized || !allowed.has(normalized)) {
        res.status(403).json({ error: "Forbidden origin" });
        return;
      }
      originAllowed = true;
    }

    const fetchSite = req.headers["sec-fetch-site"];
    if (Array.isArray(fetchSite)) {
      res.status(403).json({ error: "Forbidden origin" });
      return;
    }
    if (typeof fetchSite === "string" && fetchSite.trim()) {
      const site = fetchSite.trim().toLowerCase();
      if (!SAFE_FETCH_SITES.has(site) && !(site === "cross-site" && originAllowed)) {
        res.status(403).json({ error: "Forbidden origin" });
        return;
      }
    }

    const contentType = singleHeader(req.headers["content-type"]);
    if (!isJsonContentType(contentType)) {
      res.status(415).json({ error: "Content-Type must be application/json" });
      return;
    }

    next();
  };
}

import { afterEach, describe, expect, it } from "vitest";
import {
  buildAllowedHostnames,
  buildAllowedOrigins,
  formatExposedBindWarning,
  inferRuntimeMode,
  isAllowedHostHeader,
  isLoopbackBindHost,
  normalizeOrigin,
  parseHostHeader,
  resolveBindHosts,
} from "../src/security.js";

describe("bind host selection", () => {
  it("defaults to IPv4 and IPv6 loopback", () => {
    expect(resolveBindHosts(undefined)).toEqual(["127.0.0.1", "::1"]);
    expect(resolveBindHosts("")).toEqual(["127.0.0.1", "::1"]);
    expect(resolveBindHosts("   ")).toEqual(["127.0.0.1", "::1"]);
  });

  it("uses an explicit HOST by itself", () => {
    expect(resolveBindHosts("127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(resolveBindHosts("0.0.0.0")).toEqual(["0.0.0.0"]);
    expect(resolveBindHosts("::1")).toEqual(["::1"]);
  });

  it("treats only loopback addresses as safe binds", () => {
    expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("127.1.2.3")).toBe(true);
    expect(isLoopbackBindHost("::1")).toBe(true);
    expect(isLoopbackBindHost("[::1]")).toBe(true);
    expect(isLoopbackBindHost("localhost")).toBe(true);
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
    expect(isLoopbackBindHost("::")).toBe(false);
    expect(isLoopbackBindHost("192.168.1.10")).toBe(false);
  });
});

describe("formatExposedBindWarning", () => {
  it("is silent for loopback listeners", () => {
    expect(
      formatExposedBindWarning(["http://127.0.0.1:8787", "http://[::1]:8787"]),
    ).toBeNull();
  });

  it("is loud for any non-loopback listener", () => {
    const warning = formatExposedBindWarning(["http://0.0.0.0:8787"]);
    expect(warning).toMatch(/WARNING/);
    expect(warning).toMatch(/NO authentication/);
    expect(warning).toMatch(/UNSUPPORTED/);
    expect(warning).toMatch(/0\.0\.0\.0/);
    expect(warning).toMatch(/\*{10,}/);
  });
});

describe("Host allow-list", () => {
  const hosts = buildAllowedHostnames(["127.0.0.1", "::1"], []);
  const ports = new Set(["8787"]);

  it("parses browser Host headers", () => {
    expect(parseHostHeader("127.0.0.1:8787")).toEqual({
      hostname: "127.0.0.1",
      port: "8787",
    });
    expect(parseHostHeader("[::1]:8787")).toEqual({ hostname: "::1", port: "8787" });
    expect(parseHostHeader("LocalHost")).toEqual({ hostname: "localhost", port: null });
  });

  it("allows loopback names with the API port", () => {
    expect(isAllowedHostHeader("127.0.0.1:8787", hosts, ports)).toBe(true);
    expect(isAllowedHostHeader("localhost:8787", hosts, ports)).toBe(true);
    expect(isAllowedHostHeader("[::1]:8787", hosts, ports)).toBe(true);
    expect(isAllowedHostHeader("localhost", hosts, ports)).toBe(true);
  });

  it("rejects foreign names, lookalikes, wildcards, and the wrong port", () => {
    expect(isAllowedHostHeader("evil.example", hosts, ports)).toBe(false);
    expect(isAllowedHostHeader("evil.example:8787", hosts, ports)).toBe(false);
    expect(isAllowedHostHeader("127.0.0.1.evil.com", hosts, ports)).toBe(false);
    expect(isAllowedHostHeader("127.0.0.1.evil.com:8787", hosts, ports)).toBe(false);
    expect(isAllowedHostHeader("127.0.0.1:9", hosts, ports)).toBe(false);
    expect(isAllowedHostHeader(undefined, hosts, ports)).toBe(false);
    expect(isAllowedHostHeader("*", hosts, ports)).toBe(false);

    const withStar = buildAllowedHostnames(["0.0.0.0"], ["*", "0.0.0.0"]);
    expect(withStar.has("*")).toBe(false);
    expect(withStar.has("0.0.0.0")).toBe(false);
    expect(isAllowedHostHeader("evil.example:8787", withStar, ports)).toBe(false);
    expect(isAllowedHostHeader("127.0.0.1:8787", withStar, ports)).toBe(true);
  });

  it("honors an explicit extra hostname", () => {
    const extra = buildAllowedHostnames(["127.0.0.1"], ["diagrams.local"]);
    expect(isAllowedHostHeader("diagrams.local:8787", extra, ports)).toBe(true);
    expect(isAllowedHostHeader("other.local:8787", extra, ports)).toBe(false);
  });
});

describe("Origin allow-list", () => {
  it("allows the API's own origins in production and the Vite origin in development", () => {
    const production = buildAllowedOrigins({ mode: "production", port: 8787 });
    expect(production.has("http://127.0.0.1:8787")).toBe(true);
    expect(production.has("http://localhost:8787")).toBe(true);
    expect(production.has("http://[::1]:8787")).toBe(true);
    expect(production.has("http://localhost:5173")).toBe(false);

    const development = buildAllowedOrigins({ mode: "development", port: 8787 });
    expect(development.has("http://localhost:5173")).toBe(true);
    expect(development.has("http://127.0.0.1:5173")).toBe(true);
    expect(development.has("http://[::1]:5173")).toBe(true);
    expect(development.has("http://localhost:5174")).toBe(false);
  });

  it("adds only explicit extra origins", () => {
    const origins = buildAllowedOrigins({
      mode: "development",
      port: 8787,
      extraOrigins: ["http://localhost:5174", "not a url", "http://evil.example/path"],
    });
    expect(origins.has("http://localhost:5174")).toBe(true);
    expect(origins.has("http://evil.example")).toBe(false);
  });

  it("normalizes origins and rejects credentials or paths", () => {
    expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeOrigin("http://evil.example@127.0.0.1:5173")).toBeNull();
    expect(normalizeOrigin("http://localhost:5173/api")).toBeNull();
    expect(normalizeOrigin("null")).toBeNull();
  });
});

describe("inferRuntimeMode", () => {
  const previous = process.env.NODE_ENV;

  afterEach(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });

  it("lets NODE_ENV override the file extension", () => {
    process.env.NODE_ENV = "production";
    expect(inferRuntimeMode("file:///app/src/index.ts")).toBe("production");
    process.env.NODE_ENV = "development";
    expect(inferRuntimeMode("file:///app/dist/index.js")).toBe("development");
  });

  it("treats the TypeScript entry as dev and compiled JS as production", () => {
    delete process.env.NODE_ENV;
    expect(inferRuntimeMode("file:///app/src/index.ts")).toBe("development");
    expect(inferRuntimeMode("file:///app/dist/index.js")).toBe("production");
  });
});

import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("Vite dev server", () => {
  it("binds localhost and proxies the API to IPv4 loopback", () => {
    expect(config.server?.host).toBe("localhost");
    expect(config.server?.port).toBe(5173);
    const proxy = config.server?.proxy as
      | Record<string, { target?: string; changeOrigin?: boolean }>
      | undefined;
    expect(proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:8787",
      changeOrigin: true,
    });
  });
});

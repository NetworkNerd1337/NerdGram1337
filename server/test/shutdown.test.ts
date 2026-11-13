import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { gracefulShutdown, startServer } from "../src/listen.js";
import { resetSyncForTests, setSyncTestHook, stopSyncForShutdown, syncNow } from "../src/sync/engine.js";
import { makeTempDataDir } from "./helpers.js";

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

describe("graceful shutdown", () => {
  const servers: Server[] = [];
  let cleanup = async () => {};

  afterEach(async () => {
    setSyncTestHook(null);
    await resetSyncForTests();
    if (servers.length > 0) await gracefulShutdown(servers);
    servers.length = 0;
    await cleanup();
    cleanup = async () => {};
  });

  it("stops listening after open requests are drained", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const started = await startServer({ port: 0, hosts: ["127.0.0.1"], mode: "production" });
    servers.push(...started);
    const port = (started[0].address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/api/health", headers: { Host: `127.0.0.1:${port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(200);
    await gracefulShutdown(servers);
    servers.length = 0;
    expect(await canConnect("127.0.0.1", port)).toBe(false);
  });

  it("waits for the sync already in flight", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    let release = () => {};
    setSyncTestHook(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = syncNow().then(
      () => undefined,
      () => undefined,
    );
    let finished = false;
    const stopping = stopSyncForShutdown().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(finished).toBe(false);
    release();
    await stopping;
    await pending;
    expect(finished).toBe(true);
  });
});

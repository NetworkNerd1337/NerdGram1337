import http from "node:http";
import net from "node:net";
import os from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { closeServers, startServer } from "../src/listen.js";
import { captureConsole, makeTempDataDir } from "./helpers.js";

async function httpStatus(
  port: number,
  hostHeader: string,
  method = "GET",
  path = "/api/health",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { Host: hostHeader },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function firstLanIPv4(): string | undefined {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = entry.family as string | number;
      if (family === "IPv4" || family === 4) return entry.address;
    }
  }
  return undefined;
}

describe("startServer", () => {
  const servers: Server[] = [];
  let cleanup = async () => {};

  afterEach(async () => {
    await closeServers(servers);
    servers.length = 0;
    await cleanup();
    cleanup = async () => {};
  });

  it("binds loopback by default and refuses a foreign Host", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const previousHost = process.env.HOST;
    delete process.env.HOST;
    const captured = captureConsole();
    try {
      const started = await startServer({ port: 0, mode: "production" });
      servers.push(...started);
      const addresses = started.map((server) => {
        const address = server.address() as AddressInfo;
        return address.address;
      });
      expect(addresses).toContain("127.0.0.1");
      expect(addresses).not.toContain("0.0.0.0");
      expect(addresses).not.toContain("::");
      expect(addresses.includes("::1") || captured.errors.some((line) => line.includes("::1"))).toBe(
        true,
      );

      const v4 = started.find((server) => {
        const address = server.address() as AddressInfo;
        return address.address === "127.0.0.1";
      });
      const port = (v4?.address() as AddressInfo).port;
      const logged = captured.logs.join("\n");
      expect(logged).toContain(`http://127.0.0.1:${port}`);
      expect(logged).not.toContain("http://localhost:");

      expect(await httpStatus(port, `127.0.0.1:${port}`)).toBe(200);
      expect(await httpStatus(port, "evil.example")).toBe(403);
      expect(await httpStatus(port, `evil.example:${port}`)).toBe(403);
      expect(await canConnect("127.0.0.1", port)).toBe(true);

      const lan = firstLanIPv4();
      if (lan) {
        expect(await canConnect(lan, port)).toBe(false);
      }
    } finally {
      captured.restore();
      if (previousHost === undefined) delete process.env.HOST;
      else process.env.HOST = previousHost;
    }
  });

  it("binds only the explicit HOST", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const captured = captureConsole();
    try {
      const started = await startServer({
        port: 0,
        hosts: ["127.0.0.1"],
        mode: "production",
      });
      servers.push(...started);
      expect(started).toHaveLength(1);
      expect((started[0].address() as AddressInfo).address).toBe("127.0.0.1");
      expect(captured.errors.join("\n")).not.toMatch(/NOT loopback/);
    } finally {
      captured.restore();
    }
  });

  it("warns when HOST is not loopback and still answers on 127.0.0.1", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const captured = captureConsole();
    try {
      const started = await startServer({
        port: 0,
        hosts: ["0.0.0.0"],
        mode: "production",
      });
      servers.push(...started);
      const address = started[0].address() as AddressInfo;
      expect(address.address).toBe("0.0.0.0");
      const text = captured.errors.join("\n");
      expect(text).toMatch(/WARNING/);
      expect(text).toMatch(/NO authentication/);
      expect(text).toMatch(/UNSUPPORTED/);
      expect(text).toContain("0.0.0.0");
      expect(await httpStatus(address.port, `127.0.0.1:${address.port}`)).toBe(200);

      const lan = firstLanIPv4();
      if (lan) {
        expect(await canConnect(lan, address.port)).toBe(true);
      }
    } finally {
      captured.restore();
    }
  });

  it("fails with EADDRINUSE when the loopback port is taken", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const blocker = http.createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (blocker.address() as AddressInfo).port;
    const captured = captureConsole();
    try {
      await expect(
        startServer({ port, hosts: ["127.0.0.1"], mode: "production" }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      captured.restore();
      await new Promise<void>((resolve, reject) => {
        blocker.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

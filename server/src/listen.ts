import type { Server } from "node:http";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { createApp, type CreateAppOptions, type ListenPort } from "./app.js";
import { ensureDataRoot } from "./paths.js";
import {
  formatExposedBindWarning,
  formatListenUrl,
  inferRuntimeMode,
  resolveBindHosts,
  type RuntimeMode,
} from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type StartServerOptions = CreateAppOptions & {
  port?: number;
  hosts?: readonly string[];
  mode?: RuntimeMode;
};

function listenOn(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (err: Error) => {
      server.off("error", onError);
      server.close(() => reject(err));
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}

export async function closeServers(servers: readonly Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
          }
          server.close(() => resolve());
        }),
    ),
  );
}

function boundUrl(server: Server): string | null {
  const address = server.address();
  if (!address || typeof address === "string") return null;
  return formatListenUrl(address.address, address.port);
}

/**
 * Bind the API. When HOST is unset, listen on 127.0.0.1 and then ::1 on the
 * same port. ::1 is optional: if IPv6 loopback is unavailable, IPv4 still serves.
 * Any other failed bind rejects. A non-loopback address logs a loud warning.
 */
export async function startServer(options: StartServerOptions = {}): Promise<Server[]> {
  const port = options.port ?? Number(process.env.PORT || 8787);
  const hosts = [...(options.hosts ?? resolveBindHosts(process.env.HOST))];
  const mode = options.mode ?? inferRuntimeMode();
  const portRef: ListenPort = options.portRef ?? { port };
  const app = createApp({
    ...options,
    port,
    portRef,
    mode,
    bindHosts: options.bindHosts ?? hosts,
  });

  ensureDataRoot();

  const servers: Server[] = [];
  let listenPort = port;
  const v4Bound = () =>
    servers.some((server) => {
      const address = server.address();
      return address && typeof address !== "string" && !address.address.includes(":");
    });

  try {
    for (const host of hosts) {
      try {
        const server = await listenOn(app, listenPort, host);
        servers.push(server);
        if (listenPort === 0) {
          const address = server.address() as AddressInfo;
          listenPort = address.port;
          portRef.port = listenPort;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (host === "::1" && hosts.includes("127.0.0.1") && v4Bound()) {
          console.error(
            `NerdGram1337 could not listen on ::1 (${message}). The API is still on IPv4 loopback. If http://localhost:${listenPort} does not open, use http://127.0.0.1:${listenPort}.`,
          );
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    await closeServers(servers);
    throw err;
  }

  if (servers.length === 0) {
    throw new Error("NerdGram1337 failed to bind a listen address");
  }

  const urls = servers.map(boundUrl).filter((url): url is string => url != null);
  for (const url of urls) {
    console.log(`NerdGram1337 API listening on ${url}`);
  }
  console.log(`Data directory: ${ensureDataRoot()}`);
  console.log(`Server module dir: ${__dirname}`);

  const warning = formatExposedBindWarning(urls);
  if (warning) console.error(`\n${warning}\n`);

  return servers;
}

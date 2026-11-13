import type { Server } from "node:http";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { createApp, type CreateAppOptions, type ListenPort } from "./app.js";
import { bootBackgroundTasks, shutdownBackgroundTasks } from "./boot.js";
import { ensureDataRoot } from "./paths.js";
import { seedEmptyDataDir } from "./seed.js";
import { closeRenderer } from "./renderDiagram.js";
import { getVersionInfo } from "./updates/versionInfo.js";
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

export async function closeServers(
  servers: readonly Server[],
  options?: { drain?: boolean },
): Promise<void> {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          if (options?.drain) {
            // Drop idle keep-alive sockets so close() can finish. A request
            // that is still writing stays open until it ends.
            server.closeIdleConnections?.();
          } else if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
          }
          server.close(() => resolve());
        }),
    ),
  );
}

/**
 * Stop accepting requests, let the ones already inside finish, then wait for
 * sync and the update check. `docker stop` sends SIGTERM; this is what the
 * process runs so an atomic rename is not cut off.
 */
export async function gracefulShutdown(servers: readonly Server[]): Promise<void> {
  await closeServers(servers, { drain: true });
  await shutdownBackgroundTasks();
  await closeRenderer();
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
  if (await seedEmptyDataDir()) {
    console.log("Seeded empty data directory with the sample diagrams.");
  }

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
  const version = getVersionInfo();
  console.log(
    `Install: ${version.installKind} ${version.version}${version.codename ? ` "${version.codename}"` : ""}${version.commit ? ` ${version.commit}` : ""}`,
  );
  console.log(`Server module dir: ${__dirname}`);

  const warning = formatExposedBindWarning(urls);
  if (warning) console.error(`\n${warning}\n`);

  await bootBackgroundTasks();

  return servers;
}

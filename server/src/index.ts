import type { Server } from "node:http";
import { gracefulShutdown, startServer } from "./listen.js";
import { inferRuntimeMode } from "./security.js";

/** Leave a little room under Docker's default 10s stop timeout. */
const SHUTDOWN_MS = 8_000;

let shuttingDown = false;

function installSignalHandlers(servers: readonly Server[]): void {
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`NerdGram1337 received ${signal}. Finishing open writes and GitHub sync.`);
    const timer = setTimeout(() => {
      console.error("NerdGram1337 shutdown timed out.");
      process.exit(1);
    }, SHUTDOWN_MS);
    timer.unref();
    gracefulShutdown(servers)
      .then(() => {
        clearTimeout(timer);
        process.exit(0);
      })
      .catch((err: unknown) => {
        console.error(err);
        process.exit(1);
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

startServer({ mode: inferRuntimeMode(import.meta.url) })
  .then((servers) => {
    installSignalHandlers(servers);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

import { startServer } from "./listen.js";
import { inferRuntimeMode } from "./security.js";

startServer({ mode: inferRuntimeMode(import.meta.url) }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

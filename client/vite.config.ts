import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // The shared front matter parser lives in server/src and is imported by the client.
      allow: [repoRoot],
    },
    // Loopback only. Vite's default is already localhost; set it so a future
    // default cannot listen on every interface.
    host: "localhost",
    port: 5173,
    proxy: {
      "/api": {
        // The API binds 127.0.0.1 by default. Do not use `localhost` here:
        // on some systems that name resolves to ::1 first.
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
  },
});

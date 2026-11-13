import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
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

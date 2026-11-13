import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The data directory is process.env.NERDGRAM_DATA_DIR. Keep files sequential.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});

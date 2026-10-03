import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The Vite plugin and CLI tests start real servers and builds.
    testTimeout: 30_000,
    restoreMocks: true,
    unstubGlobals: true,
  },
});

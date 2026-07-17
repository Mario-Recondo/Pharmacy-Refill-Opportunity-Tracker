import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Tauri runtime doesn't exist under vitest; alias its two entry points the
// data layer touches onto stubs backed by an in-memory node:sqlite database
// that runs the real migrations (tests/helpers/fakeTauri.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@tauri-apps/plugin-sql": fileURLToPath(new URL("./tests/stubs/plugin-sql.ts", import.meta.url)),
      "@tauri-apps/api/core": fileURLToPath(new URL("./tests/stubs/api-core.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

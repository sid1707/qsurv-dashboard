import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // e2e/ is Playwright's (npm run test:e2e).
    exclude: ["**/node_modules/**", "e2e/**"],
  },
})

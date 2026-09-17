import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  test: { environment: "node", setupFiles: ["./tests/setup.ts"], include: ["tests/**/*.test.{ts,tsx}"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src"), "server-only": path.resolve(__dirname, "./tests/server-only.ts") } },
});

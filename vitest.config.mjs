import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests unitaires (npm test). Alias « @/… » = racine du dépôt, comme dans next.config.js.
const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: root }] },
  test: { include: ["tests/**/*.test.js"], environment: "node" },
});

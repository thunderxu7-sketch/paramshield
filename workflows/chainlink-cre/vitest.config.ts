import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The SDK targets Bun/QuickJS and publishes extensionless ESM imports.
    // Transform it for Node-based unit tests; real WASM is tested separately.
    server: { deps: { inline: ["@chainlink/cre-sdk"] } },
  },
});

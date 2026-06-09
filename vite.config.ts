import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // GitHub project pages: BASE_PATH=/meshcore-packet-tool/ make build
  base: process.env.BASE_PATH ?? "/",
  plugins: [svelte()],
  server: {
    headers: {
      // Required for SharedArrayBuffer; also ensures .wasm MIME is correct.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Relative base so the build works on GitHub Pages project URLs (/<repo>/).
  base: "./",
  plugins: [preact()],
  resolve: {
    alias: { "@data": fileURLToPath(new URL("../data", import.meta.url)) },
  },
  server: { fs: { allow: [".."] } },
});

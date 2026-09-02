import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  noExternal: ["@game-moto/protocol", "@game-moto/simulation"],
});

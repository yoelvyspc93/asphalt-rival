import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function publicBase() {
  if (process.env.VITE_BASE) {
    return process.env.VITE_BASE.endsWith("/") ? process.env.VITE_BASE : `${process.env.VITE_BASE}/`;
  }

  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY) {
    const repo = process.env.GITHUB_REPOSITORY.split("/")[1];
    if (repo) return `/${repo}/`;
  }

  return "/";
}

export default defineConfig({
  base: publicBase(),
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // pdfjs-dist 4.x ships modern syntax (top-level await); raise the build target.
  build: {
    target: "esnext"
  },
  worker: {
    format: "es"
  }
});

import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const mobileHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,

  server: {
    // Android must be able to reach the Vite development server.
    host: mobileHost || "0.0.0.0",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    hmr: mobileHost
      ? {
          protocol: "ws",
          host: mobileHost,
          port: 1421,
        }
      : undefined,
  },
})

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // .env.* files live in project root (one level above front/)
  const projectRoot = path.resolve(process.cwd(), "..");
  const env = loadEnv(mode, projectRoot, "");
  const backendPort = env.BACKEND_PORT || process.env.BACKEND_PORT || "8200";
  const frontendPort = Number(env.FRONTEND_PORT || process.env.FRONTEND_PORT) || 4200;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: frontendPort,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        "/mcp": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});

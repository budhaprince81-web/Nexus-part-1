import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const replitDevPlugins =
  process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
    ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          }),
        ),
      ]
    : [];

// PORT is only required to run the dev/preview server. Production builds
// (`vite build`) must not require it, otherwise `pnpm run build` fails.
function resolvePort(): number {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...replitDevPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: command === "serve" ? resolvePort() : undefined,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port: command === "serve" ? resolvePort() : undefined,
    host: "0.0.0.0",
    allowedHosts: true,
  },
}));

import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Self Dictation",
        short_name: "Dictation",
        description: "Hear it, write it. Works offline, no account, no server.",
        theme_color: "#101014",
        background_color: "#101014",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
    }),
  ],
});

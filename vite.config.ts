import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.DATA_EDITOR_VITE_PORT ?? 8787);
const apiPort = Number(process.env.DATA_EDITOR_API_PORT ?? 8788);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});

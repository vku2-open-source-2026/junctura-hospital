// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5182, strictPort: true,
    proxy: { "/api": process.env.HOSPITAL_API ?? "http://127.0.0.1:5192" } },
  test: { environment: "node" },
});

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "./env.mjs";

// Adapted from Clinic: environment overrides the private Health demo configuration.
export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const healthDir = resolve(cwd, env.JUNCTURA_HEALTH_DIR ?? "../junctura-health");
  const envFile = resolve(cwd, env.JUNCTURA_HOSPITAL_ENV ?? `${healthDir}/.junctura/demo/junctura-hospital.env`);
  const file = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const get = name => env[name] ?? file[name];
  const issuer = get("JUNCTURA_ISSUER")?.replace(/\/+$/, "");
  const webClientId = get("JUNCTURA_WEB_CLIENT_ID");
  if (!issuer || !webClientId) throw new Error("Run npm run demo:setup in junctura-health, or set JUNCTURA_ISSUER and JUNCTURA_WEB_CLIENT_ID.");
  const identity = new URL(issuer);
  if (identity.username || identity.password || identity.search || identity.hash ||
      (identity.protocol !== "https:" && !(identity.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(identity.hostname)))) {
    throw new Error("JUNCTURA_ISSUER must use HTTPS or HTTP loopback for local development.");
  }
  const port = Number(get("PORT") ?? get("WEB_PORT") ?? 5182);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be a valid port number.");
  return Object.freeze({ issuer, webClientId, port, host: get("HOST") ?? "127.0.0.1",
    issuerInternal: (get("JUNCTURA_ISSUER_INTERNAL") ?? issuer).replace(/\/+$/, ""),
    accountsFile: resolve(healthDir, "seed/data/accounts.json"),
    subjectsFile: resolve(healthDir, ".junctura/demo/subjects.json"),
    staticDir: resolve(cwd, get("HOSPITAL_STATIC_DIR") ?? "web/dist"),
    facility: "Bệnh viện Đà Nẵng" });
}

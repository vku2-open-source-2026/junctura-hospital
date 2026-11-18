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
  const baseUrl = get("JUNCTURA_URL"), clientId = get("JUNCTURA_APP_CLIENT_ID"), clientSecret = get("JUNCTURA_APP_CLIENT_SECRET");
  const clinicEnv = resolve(healthDir, ".junctura/demo/junctura-clinic.env");
  const providerAppId = get("JUNCTURA_REFERRAL_PROVIDER_APP_ID") ??
    (existsSync(clinicEnv) ? parseEnv(readFileSync(clinicEnv, "utf8")).JUNCTURA_APP_ID : undefined);
  const pharmacyEnv = resolve(healthDir, ".junctura/demo/junctura-pharmacy.env");
  const pharmacyAppId = get("JUNCTURA_PHARMACY_APP_ID") ?? (existsSync(pharmacyEnv) ? parseEnv(readFileSync(pharmacyEnv, "utf8")).JUNCTURA_APP_ID : undefined);
  const insuranceEnv = resolve(healthDir, ".junctura/demo/junctura-insurance.env");
  const insuranceAppId = get("JUNCTURA_INSURANCE_APP_ID") ?? (existsSync(insuranceEnv) ? parseEnv(readFileSync(insuranceEnv,"utf8")).JUNCTURA_APP_ID : undefined);
  const cert = get("PROVIDER_TLS_CERT"), key = get("PROVIDER_TLS_KEY");
  const providerPort = Number(get("PROVIDER_PORT") ?? 8443);
  if (Boolean(cert) !== Boolean(key) || !Number.isInteger(providerPort) || providerPort < 1 || providerPort > 65535) throw new Error("Invalid provider TLS configuration");
  return Object.freeze({
    pharmacyAppId, insuranceAppId, provider: cert ? Object.freeze({ certFile: resolve(cwd, cert), keyFile: resolve(cwd, key), host: get("PROVIDER_BIND") ?? "127.0.0.1", port: providerPort }) : null,
    junctura: baseUrl && clientId && clientSecret ? Object.freeze({ baseUrl, clientId, clientSecret }) : null,
    referralProviderAppId: providerAppId,
    appId: get("JUNCTURA_APP_ID"), healthDir, demoEnabled: get("HOSPITAL_DEMO") === "true",
    issuer, webClientId, port, host: get("HOST") ?? "127.0.0.1",
    issuerInternal: (get("JUNCTURA_ISSUER_INTERNAL") ?? issuer).replace(/\/+$/, ""),
    accountsFile: resolve(healthDir, "seed/data/accounts.json"),
    subjectsFile: resolve(healthDir, ".junctura/demo/subjects.json"),
    staticDir: resolve(cwd, get("HOSPITAL_STATIC_DIR") ?? "web/dist"),
    facility: "Bệnh viện Đà Nẵng" });
}

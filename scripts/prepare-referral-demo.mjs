// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../server/config.mjs";
import { parseEnv } from "../server/env.mjs";
import { demoCases } from "../server/demo.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const config = loadConfig({ cwd: root });
  if (!config.junctura || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.junctura.baseUrl).hostname)) throw new Error("This helper requires a local Health demo stack.");
  const coreDir = resolve(root, process.env.JUNCTURA_DXOS_DIR ?? "../junctura-dxos");
  if (!process.env.KEYCLOAK_ADMIN_PASSWORD) process.loadEnvFile(resolve(coreDir, ".env"));
  const { connectDemoStack } = await import(pathToFileURL(resolve(coreDir, "scripts/lib/demo-stack.mjs")).href);
  const hospital = parseEnv(readFileSync(resolve(config.healthDir, ".junctura/demo/junctura-hospital.env"), "utf8"));
  const password = parseEnv(readFileSync(resolve(config.healthDir, ".junctura/demo/accounts.env"), "utf8")).DEMO_PASSWORD;
  const subjects = existsSync(config.subjectsFile) ? JSON.parse(readFileSync(config.subjectsFile, "utf8")) : {};
  const cases = demoCases(config.healthDir, subjects);
  const stack = await connectDemoStack({ tenant: "tenant-a", base: config.junctura.baseUrl });
  const anToken = await stack.login(cases[0].username, password);
  const statePath = resolve(root, ".junctura/referral-demo-consent.json");
  const owned = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  if (process.argv.includes("--clear")) {
    if (!owned?.consentId) throw new Error("No consent owned by this helper; existing patient consent is unchanged.");
    const response = await stack.api(`/v1/me/consents/${owned.consentId}/revoke`, anToken, {});
    if (response.status !== 200) throw new Error("Could not revoke this helper's demo consent.");
    console.log("Revoked this helper's consent only. Other consent was left unchanged.");
  } else {
    const capabilityId = `urn:junctura:capability:${config.referralProviderAppId}:referral-summary`;
    const active = value => value.consumer?.appId === hospital.JUNCTURA_APP_ID && value.capabilityId === capabilityId && value.state === "active" && value.purposes.includes("referral_intake");
    const deniedToken = await stack.login(cases[1].username, password);
    const deniedResponse = await stack.api("/v1/me/consents", deniedToken);
    if (deniedResponse.status !== 200 || (await deniedResponse.json()).consents.some(active)) throw new Error("The second demo patient already has consent or cannot be verified. No consent was revoked.");
    const response = await stack.api("/v1/me/consents", anToken);
    if (response.status !== 200) throw new Error("Could not check the demo patient's consent.");
    const prior = (await response.json()).consents.find(active);
    if (!prior) {
      const granted = await stack.api("/v1/me/consents", anToken, { consumerAppId: hospital.JUNCTURA_APP_ID, capabilityId,
        purposes: ["referral_intake"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
      if (granted.status !== 201) throw new Error("Could not grant the demo consent.");
      mkdirSync(resolve(root, ".junctura"), { recursive: true });
      writeFileSync(statePath, JSON.stringify({ consentId: (await granted.json()).consentId }) + "\n", { mode: 0o600 });
    }
    console.log("Demo ready: An can share the referral for 24 hours (or uses existing active consent); the second patient has no consent.");
    for (const item of cases) console.log(`${item.label}: ${item.patientSubject} / ${item.referralId}`);
    console.log("Start with npm run demo:start, open Tiep nhan, and select a demo case. No patient password or token is printed.");
  }
} catch (error) { console.error(error.status ? "Local Core rejected the demo operation." : error.message); process.exitCode = 1; }

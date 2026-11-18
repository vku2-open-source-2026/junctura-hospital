// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createJuncturaClient } from "@junctura/server-client";
import { createEmergency } from "./emergency.mjs";
import { createPrescriptions, loadPrescriptionCatalog } from "./prescriptions.mjs";
import { startPrescriptionProvider } from "./prescription-provider.mjs";
import { createExaminations } from "./examinations.mjs";
import { createPrevisitLookup, createAllergyLookup } from "./previsit.mjs";
import { createAdmissions } from "./admissions.mjs";
import { demoCases, emergencyDemo } from "./demo.mjs";
import { readFileSync, existsSync } from "node:fs";
import { createReferralLookup } from "./referrals.mjs";
import { createServer } from "node:http";
import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { createVerifier } from "./jwt.mjs";
import { loadStaff } from "./staff.mjs";

try {
  let config = loadConfig();
  const flag = process.argv.indexOf("--port");
  if (flag !== -1) {
    const port = Number(process.argv[flag + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port requires a valid port.");
    config = Object.freeze({ ...config, port });
  }
  if (process.argv.includes("--demo")) config = Object.freeze({ ...config, demoEnabled: true });
  const subjects = existsSync(config.subjectsFile) ? JSON.parse(readFileSync(config.subjectsFile, "utf8")) : {};
  const examples = config.demoEnabled ? demoCases(config.healthDir, subjects) : undefined;
  const staff = loadStaff(config);
  const verifier = createVerifier({ issuer: config.issuer, keysBase: config.issuerInternal, clientId: config.webClientId });
  const junctura = config.junctura ? createJuncturaClient({ ...config.junctura, timeoutMs: 5000 }) : null;
  const lookupReferral = createReferralLookup({ junctura, providerAppId: config.referralProviderAppId });
  const admissions = createAdmissions({ junctura, appId: config.appId, facility: config.facility, lookupReferral });
  const examinations = createExaminations({ junctura, admissions, lookupSummary: createPrevisitLookup({ junctura, providerAppId: config.referralProviderAppId }) });
  const prescriptions = createPrescriptions({ junctura, examinations, catalog: await loadPrescriptionCatalog(config.healthDir), lookupAllergies: createAllergyLookup({ junctura, providerAppId: config.referralProviderAppId }) });
  const emergency = createEmergency({junctura,appId:config.appId,providerAppId:config.referralProviderAppId,lookups:{"pre-visit-summary":createPrevisitLookup({junctura,providerAppId:config.referralProviderAppId}),"allergy-list":createAllergyLookup({junctura,providerAppId:config.referralProviderAppId})}});
  const emergencyExample = config.demoEnabled ? emergencyDemo(config.healthDir,subjects) : undefined;
  const provider = startPrescriptionProvider(config, junctura, prescriptions);
  provider?.on("error", error => { console.error(`Provider failed (${error.code ?? "provider_error"}).`); server.close(); process.exitCode = 1; });
  const server = createServer(createApp({ config, staff, verifier, lookupReferral, admissions, examinations, prescriptions, emergency, emergencyExample, examples }));
  server.on("error", error => { console.error(`Hospital could not start (${error.code ?? "server_error"}).`); process.exitCode = 1; });
  server.listen(config.port, config.host, () => console.log(`Junctura Hospital listening on http://${config.host}:${server.address().port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { provider?.close(); server.close(() => process.exit(0)); });
} catch (error) { console.error(error.message); process.exitCode = 1; }

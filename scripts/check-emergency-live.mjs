// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Read-only verification of an existing synthetic emergency request; never creates or approves one.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJuncturaClient } from "@junctura/server-client";
import { loadConfig } from "../server/config.mjs";
import { parseEnv } from "../server/env.mjs";
import { emergencyDemo } from "../server/demo.mjs";
import { COLLECTION } from "../server/emergency.mjs";
try {
  const c = loadConfig();
  if (
    !c.junctura ||
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(c.junctura.baseUrl).hostname,
    )
  )
    throw Error("Local synthetic demo only");
  const coreDir = resolve(process.env.JUNCTURA_DXOS_DIR ?? "../junctura-dxos");
  if (!process.env.KEYCLOAK_ADMIN_PASSWORD)
    process.loadEnvFile(resolve(coreDir, ".env"));
  const { connectDemoStack } = await import(
    pathToFileURL(resolve(coreDir, "scripts/lib/demo-stack.mjs")).href
  );
  const subjects = existsSync(c.subjectsFile)
    ? JSON.parse(readFileSync(c.subjectsFile, "utf8"))
    : {};
  const binh = emergencyDemo(c.healthDir, subjects);
  const sdk = createJuncturaClient(c.junctura);
  const { items } = await (
    await sdk.request(`/v2/data/${COLLECTION}?limit=100`)
  ).json();
  const rows = items
    .filter(
      (v) =>
        v.data?.patientSubject === binh.patientSubject && v.data?.executionId,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const row = process.argv[2]
    ? rows.find((v) => v.data.executionId === process.argv[2])
    : rows[0];
  if (!row)
    throw Error("Use the Hospital emergency UI with synthetic Binh first");
  const execution = await sdk.execution(row.data.executionId);
  assert.equal(execution.state, "succeeded");
  assert.equal(
    execution.target.capability.capabilityId,
    `urn:junctura:capability:${c.referralProviderAppId}:${row.data.capability}`,
  );
  const stack = await connectDemoStack({
    tenant: "tenant-a",
    base: c.junctura.baseUrl,
  });
  const password = parseEnv(
    readFileSync(resolve(c.healthDir, ".junctura/demo/accounts.env"), "utf8"),
  ).DEMO_PASSWORD;
  const token = await stack.login(binh.username, password);
  const consents = await stack.api("/v1/me/consents", token);
  assert.equal(consents.status, 200);
  assert.equal(
    (await consents.json()).consents.some(
      (v) =>
        v.consumer?.appId === c.appId &&
        v.capabilityId === execution.target.capability.capabilityId &&
        v.state === "active" &&
        v.purposes.includes("treatment"),
    ),
    false,
    "Binh already has matching consent; leave that consent unchanged.",
  );
  const access = await stack.api("/v1/me/data-access", token);
  assert.equal(access.status, 200);
  const entry = (await access.json()).entries.find(
    (v) => v.executionId === row.data.executionId,
  );
  assert.ok(entry, "Core must show the emergency access to its data subject");
  assert.equal(entry.emergency, true);
  assert.equal(entry.purpose, "treatment");
  assert.equal(entry.consumer.appId, c.appId);
  assert.ok(["pending", "justified", "unjustified"].includes(entry.review));
  console.log(
    "Existing Binh emergency access succeeded without matching consent. Core shows emergency=true and review state " +
      entry.review +
      " in the patient's access log. No review or consent was changed.",
  );
} catch (e) {
  console.error(
    e.status
      ? "Core refused the read-only live check; verify the local demo stack."
      : e.message,
  );
  process.exitCode = 1;
}

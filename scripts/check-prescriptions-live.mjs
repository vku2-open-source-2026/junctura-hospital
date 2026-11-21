// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createJuncturaClient } from "@junctura/server-client";
import {
  buildManifest,
  validateValue,
  getContract,
} from "@junctura/health-contracts";
import { loadConfig } from "../server/config.mjs";
import { parseEnv } from "../server/env.mjs";
import {
  createPrescriptions,
  loadPrescriptionCatalog,
} from "../server/prescriptions.mjs";
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
try {
  const c = loadConfig();
  if (
    !c.junctura ||
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(c.junctura.baseUrl).hostname,
    )
  )
    throw Error("Local synthetic demo only");
  const env = parseEnv(
    readFileSync(
      resolve(c.healthDir, ".junctura/demo/junctura-pharmacy.env"),
      "utf8",
    ),
  );
  if (env.JUNCTURA_URL !== c.junctura.baseUrl)
    throw Error("Both demo clients must use the same local Core");
  const hospital = createJuncturaClient(c.junctura),
    service = createPrescriptions({
      junctura: hospital,
      catalog: await loadPrescriptionCatalog(c.healthDir),
    });
  const { items } = await service.list();
  const subject = "525fd3dc-fa8c-4472-9c8d-2359aa031f40",
    rx = items.find((v) => v.patientSubject === subject && !v.expired);
  if (!rx) throw Error("Issue a synthetic An prescription in Hospital first");
  const pharmacy = createJuncturaClient({
    baseUrl: env.JUNCTURA_URL,
    clientId: env.JUNCTURA_APP_CLIENT_ID,
    clientSecret: env.JUNCTURA_APP_CLIENT_SECRET,
  });
  const manifest = buildManifest("prescription-verify", c.appId),
    target = {
      kind: "capability",
      capability: {
        capabilityId: manifest.capabilityId,
        version: manifest.version,
        manifestDigest: `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`,
      },
    };
  for (const [code, valid] of [
    [rx.prescriptionCode, true],
    ["DT-NO-RECORD", false],
  ]) {
    const execution = await pharmacy.execute(
      target,
      { prescriptionCode: code },
      undefined,
      { purpose: "dispensing", dataSubject: subject },
    );
    const result = await pharmacy.waitForExecution(execution.executionId, {
      timeoutMs: 20000,
      intervalMs: 500,
    });
    assert.equal(result.state, "succeeded", result.error);
    assert.deepEqual(
      validateValue(
        getContract("prescription-verify").outputSchema,
        result.output,
      ),
      [],
    );
    assert.equal(result.output.valid, valid);
    assert.deepEqual(Object.keys(result.output).sort(), [
      "dispensed",
      "expiresAt",
      "issuedAt",
      "items",
      "valid",
    ]);
    if (valid) assert.deepEqual(result.output.items, rx.items);
    else assert.deepEqual(result.output.items, []);
  }
  console.log(
    "Pharmacy -> Core -> Hospital TLS provider: existing prescription verified, missing code refused, exact contract fields only.",
  );
} catch (error) {
  console.error(
    error.status
      ? "Core rejected the live verification; check demo consent and grants."
      : error.message,
  );
  process.exitCode = 1;
}

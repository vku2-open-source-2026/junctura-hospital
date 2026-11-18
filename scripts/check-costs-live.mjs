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
import { createCosts } from "../server/costs.mjs";
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
      resolve(c.healthDir, ".junctura/demo/junctura-insurance.env"),
      "utf8",
    ),
  );
  if (env.JUNCTURA_URL !== c.junctura.baseUrl)
    throw Error("Both demo clients must use the same local Core");
  const hospital = createJuncturaClient(c.junctura),
    service = createCosts({ junctura: hospital });
  const { items } = await service.list();
  const subject = "525fd3dc-fa8c-4472-9c8d-2359aa031f40",
    rx = items.find((v) => v.patientSubject === subject);
  if (!rx) throw Error("Save a synthetic An cost record in Hospital first");
  const insurance = createJuncturaClient({
    baseUrl: env.JUNCTURA_URL,
    clientId: env.JUNCTURA_APP_CLIENT_ID,
    clientSecret: env.JUNCTURA_APP_CLIENT_SECRET,
  });
  const manifest = buildManifest("claim-verify", c.appId),
    target = {
      kind: "capability",
      capability: {
        capabilityId: manifest.capabilityId,
        version: manifest.version,
        manifestDigest: `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`,
      },
    };
  for (const [code, amountVnd, matches] of [
    [rx.claimId, rx.amountVnd, true],
    [
      rx.claimId,
      rx.amountVnd === 1e12 ? rx.amountVnd - 1 : rx.amountVnd + 1,
      false,
    ],
    ["HS-NO-RECORD", rx.amountVnd, false],
  ]) {
    const execution = await insurance.execute(
      target,
      { claimId: code, amountVnd },
      undefined,
      { purpose: "claim_review", dataSubject: subject },
    );
    const result = await insurance.waitForExecution(execution.executionId, {
      timeoutMs: 20000,
      intervalMs: 500,
    });
    assert.equal(result.state, "succeeded", result.error);
    assert.deepEqual(
      validateValue(getContract("claim-verify").outputSchema, result.output),
      [],
    );
    assert.equal(result.output.matches, matches);
    assert.deepEqual(Object.keys(result.output).sort(), [
      "checkedAt",
      "matches",
    ]);
  }
  // The helper verifies this second synthetic patient has no matching consent.
  let denied = false;
  try {
    const e = await insurance.execute(
      target,
      { claimId: rx.claimId, amountVnd: rx.amountVnd },
      undefined,
      {
        purpose: "claim_review",
        dataSubject: "477f1c8b-c312-481c-a4ee-192d856e267b",
      },
    );
    const r = await insurance.waitForExecution(e.executionId, {
      timeoutMs: 20000,
      intervalMs: 500,
    });
    denied = r.state !== "succeeded" && r.error === "subject_consent_required";
  } catch (e) {
    denied = e.code === "subject_consent_required";
  }
  assert.equal(
    denied,
    true,
    "Second synthetic patient must be refused for missing consent",
  );
  console.log(
    "Insurance -> Core -> Hospital TLS: exact amount matches, wrong amount/code refused; output contains only matches and checkedAt; unconsented patient refused.",
  );
} catch (error) {
  console.error(
    error.status
      ? "Core rejected the live verification; check demo consent and grants."
      : error.message,
  );
  process.exitCode = 1;
}

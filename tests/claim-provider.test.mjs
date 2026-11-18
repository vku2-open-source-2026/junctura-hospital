// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { buildManifest } from "@junctura/health-contracts";
import { createPrescriptionHandler } from "../server/prescription-provider.mjs";
const appId = "11111111-1111-4111-8111-111111111111",
  insuranceAppId = "22222222-2222-4222-8222-222222222222",
  subject = "33333333-3333-4333-8333-333333333333",
  invocationId = randomUUID();
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
const manifest = buildManifest("claim-verify", appId),
  capability = {
    capabilityId: manifest.capabilityId,
    version: manifest.version,
    manifestDigest: `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`,
  };
const context = {
  dataSubject: subject,
  purpose: "claim_review",
  emergency: false,
  providerAppId: appId,
  actorAppId: insuranceAppId,
  invocationId,
  capability,
};
async function fixture(t, options = {}) {
  const calls = [],
    state = { active: true, context: structuredClone(context), ...options };
  const server = createServer(
    createPrescriptionHandler({
      appId,
      insuranceAppId,
      junctura: {
        redeemTicket: async (value) => {
          calls.push(["redeem", value]);
          return { active: state.active, context: state.context };
        },
      },
      costs: {
        verify: async (...args) => {
          calls.push(["verify", ...args]);
          return { matches: true, checkedAt: "2026-11-18T08:00:00.000Z" };
        },
      },
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return {
    calls,
    state,
    post: (
      body = { invocationId, input: { claimId: "HS-TEST", amountVnd: 250000 } },
      headers = {},
    ) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/capabilities/claim-verify`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + "a".repeat(43),
            ...headers,
          },
          body: typeof body === "string" ? body : JSON.stringify(body),
        },
      ),
  };
}
test("claim provider redeems Core ticket before reading and exposes exactly the two contract fields", async (t) => {
  const f = await fixture(t);
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.calls[1], ["verify", subject, "HS-TEST", 250000]);
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ["output"]);
  assert.deepEqual(Object.keys(result.output).sort(), ["checkedAt", "matches"]);
  assert.deepEqual(f.calls[0][1].input, {
    claimId: "HS-TEST",
    amountVnd: 250000,
  });
});
test("inactive or replayed tickets cannot read costs", async (t) => {
  const f = await fixture(t, { active: false });
  assert.equal((await f.post()).status, 403);
  assert.equal(
    f.calls.some((v) => v[0] === "verify"),
    false,
  );
});
test("rejects wrong capability/version/digest, caller, subject, purpose and emergency context", async (t) => {
  const f = await fixture(t);
  for (const changed of [
    { providerAppId: insuranceAppId },
    { actorAppId: appId },
    { purpose: "treatment" },
    { emergency: true },
    { dataSubject: "" },
    { invocationId: randomUUID() },
    { capability: { ...capability, version: "9.0.0" } },
    { capability: { ...capability, capabilityId: "other" } },
    { capability: { ...capability, manifestDigest: "sha256:wrong" } },
  ]) {
    f.state.context = { ...context, ...changed };
    assert.equal((await f.post()).status, 403);
  }
  assert.equal(
    f.calls.some((v) => v[0] === "verify"),
    false,
  );
});
test("malformed or oversized payloads fail before spending a ticket", async (t) => {
  const f = await fixture(t);
  for (const body of [
    "{",
    null,
    [],
    {
      invocationId,
      input: { claimId: "HS", amountVnd: 1, diagnosis: "injected" },
    },
  ])
    assert.equal((await f.post(body)).status, 400);
  assert.equal((await f.post("x".repeat(4097))).status, 413);
  assert.equal(f.calls.length, 0);
});

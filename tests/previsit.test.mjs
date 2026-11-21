// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildManifest } from "@junctura/health-contracts";
import { createPrevisitLookup, createAllergyLookup, validSummary } from "../server/previsit.mjs";
const providerAppId = "11111111-1111-4111-8111-111111111111",
  subject = "22222222-2222-4222-8222-222222222222",
  executionId = "33333333-3333-4333-8333-333333333333";
const example = JSON.parse(
  readFileSync(
    new URL(
      "../node_modules/@junctura/health-contracts/examples/pre-visit-summary.json",
      import.meta.url,
    ),
    "utf8",
  ),
).output;
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const manifest = buildManifest("pre-visit-summary", providerAppId);
const item = {
  state: "published",
  capabilityId: manifest.capabilityId,
  providerAppId,
  version: manifest.version,
  digest: `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`,
};
function fixture(changes = {}) {
  const calls = [];
  const sdk = {
    discover: async () => ({ items: [item] }),
    execute: async (...args) => {
      calls.push(args);
      return { executionId };
    },
    waitForExecution: async () => ({ state: "succeeded", output: example }),
    ...changes,
  };
  return {
    lookup: createPrevisitLookup({ junctura: sdk, providerAppId }),
    calls,
  };
}
test("previsit uses the exact Health manifest, empty input and treatment subject context", async () => {
  const f = fixture();
  const result = await f.lookup(subject);
  assert.deepEqual(result.summary, example);
  assert.equal(result.patientSubject, subject);
  assert.deepEqual(f.calls[0], [
    {
      kind: "capability",
      capability: {
        capabilityId: item.capabilityId,
        version: item.version,
        manifestDigest: item.digest,
      },
    },
    {},
    undefined,
    { purpose: "treatment", dataSubject: subject },
  ]);
});
test("refuses wrong manifest and keeps consent distinct from an empty summary", async () => {
  const wrong = fixture({
    discover: async () => ({ items: [{ ...item, digest: "sha256:wrong" }] }),
  });
  await assert.rejects(wrong.lookup(subject), {
    code: "summary_capability_unavailable",
  });
  assert.equal(wrong.calls.length, 0);
  for (const [state, code] of [
    [
      { state: "failed", error: "subject_consent_required" },
      "treatment_consent_required",
    ],
    [{ state: "failed", error: "provider_failed" }, "summary_provider_failed"],
    [{ state: "timed_out" }, "summary_timeout"],
  ])
    await assert.rejects(
      fixture({ waitForExecution: async () => state }).lookup(subject),
      { code },
    );
});
test("allergy states are coherent and dates/sex/severity are checked beyond the schema", () => {
  assert.equal(validSummary(example), true);
  for (const changed of [
    { allergyState: "none-known" },
    { allergies: [] },
    { allergyState: "unknown" },
    { sex: "unknown" },
    { birthYear: 2099 },
    { updatedAt: "x".repeat(24) },
    { allergies: [{ ...example.allergies[0], severity: "unknown" }] },
    {
      recentEncounters: [
        {
          date: "2026-02-30",
          reason: "test",
          diagnosis: { code: "", name: "test" },
        },
      ],
    },
  ])
    assert.equal(validSummary({ ...example, ...changed }), false);
  for (const state of ["none-known", "not-recorded"])
    assert.equal(
      validSummary({ ...example, allergies: [], allergyState: state }),
      true,
    );
});
test("cancellation and bad patient IDs never submit a capability", async () => {
  const f = fixture();
  await assert.rejects(f.lookup("fake"), { code: "invalid_examination" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.lookup(subject, controller.signal), {
    code: "summary_timeout",
  });
  assert.equal(f.calls.length, 0);
});

test("allergy-list uses its own Health manifest and treatment consent",async()=>{
 const m=buildManifest("allergy-list",providerAppId),published={state:"published",capabilityId:m.capabilityId,providerAppId,version:m.version,digest:`sha256:${createHash("sha256").update(canonical(m)).digest("hex")}`};const calls=[];
 const output={allergies:example.allergies,allergyState:example.allergyState,updatedAt:example.updatedAt};
 const lookup=createAllergyLookup({providerAppId,junctura:{discover:async()=>({items:[published]}),execute:async(...args)=>{calls.push(args);return {executionId};},waitForExecution:async()=>({state:"succeeded",output})}});
 assert.deepEqual((await lookup(subject)).summary,output);assert.equal(calls[0][0].capability.capabilityId,m.capabilityId);assert.deepEqual(calls[0][3],{purpose:"treatment",dataSubject:subject});
});

test("emergency uses an explicit stable key and confirmed justification; normal calls stay consent-gated",async()=>{const calls=[],reserved=[],operationId="44444444-4444-4444-8444-444444444444";const lookup=createPrevisitLookup({providerAppId,junctura:{discover:async()=>({items:[item]}),execute:async(...args)=>{calls.push(args);return {executionId};},waitForExecution:async()=>({state:"succeeded",output:example})}});const justification="Kiểm thử quyền cấp cứu giả lập";await lookup(subject,undefined,{operationId,justification,onReserved:async id=>reserved.push(id)});assert.equal(calls[0][2],operationId);assert.deepEqual(calls[0][3],{purpose:"treatment",dataSubject:subject,emergency:true,justification});assert.deepEqual(reserved,[executionId]);await assert.rejects(createPrevisitLookup({providerAppId,slug:"referral-summary"})(subject,undefined,{operationId,justification}),{code:"invalid_emergency_access"});});

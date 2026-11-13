// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildManifest } from "@junctura/health-contracts";
import { createReferralLookup, validateLookup } from "../server/referrals.mjs";
const providerAppId = "11111111-1111-4111-8111-111111111111";
const subject = "22222222-2222-4222-8222-222222222222";
const executionId = "33333333-3333-4333-8333-333333333333";
const input = { patientSubject: subject, referralId: "CT-TEST" };
const output = { referralId: "CT-TEST", issuedAt: "2026-11-01T09:30:00.000Z", fromFacility: "Trạm giả lập", toFacility: "Bệnh viện giả lập",
  urgency: "urgent", reason: "Lý do giả lập", provisionalDiagnosis: { code: "", name: "Chưa rõ" }, treatmentGiven: "Chưa rõ" };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const manifest = buildManifest("referral-summary", providerAppId);
const item = { capabilityId: manifest.capabilityId, providerAppId, version: manifest.version, digest: `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`, state: "published" };
function fixture(overrides = {}) {
  const calls = [];
  const junctura = { discover: async (...args) => { calls.push(["discover", ...args]); return { items: [item] }; },
    execute: async (...args) => { calls.push(["execute", ...args]); return { executionId }; },
    waitForExecution: async (...args) => { calls.push(["wait", ...args]); return { state: "succeeded", output }; }, ...overrides };
  return { calls, lookup: createReferralLookup({ junctura, providerAppId }) };
}
test("uses exact Health manifest, input, subject context and the Core SDK", async () => {
  const { lookup, calls } = fixture();
  const result = await lookup(input);
  assert.deepEqual(result.referral, output);
  const [, target, payload, key, context] = calls.find(call => call[0] === "execute");
  assert.deepEqual(target, { kind: "capability", capability: { capabilityId: item.capabilityId, version: item.version, manifestDigest: item.digest } });
  assert.deepEqual(payload, { referralId: input.referralId });
  assert.equal(key, undefined);
  assert.deepEqual(context, { purpose: "referral_intake", dataSubject: subject });
  assert.equal(result.patientSubject, subject);
});
test("rejects extra context/emergency flags, malformed subjects and invalid input before Core", () => {
  for (const value of [null, [], {}, { ...input, emergency: true }, { ...input, purpose: "treatment" },
    { ...input, patientSubject: "P0001" }, { ...input, referralId: "x".repeat(65) }, { ...input, referralId: "\n" }, { ...input, referralId: "a\nb" }]) {
    assert.throws(() => validateLookup(value), { code: "invalid_lookup" });
  }
});
test("discovers across pages but refuses a different contract digest or provider", async () => {
  const { lookup, calls } = fixture({ discover: async ({ cursor }) => !cursor ? { items: [], nextCursor: "next" } : { items: [item] } });
  assert.equal((await lookup(input)).executionId, executionId);
  assert.equal(calls.filter(call => call[0] === "execute").length, 1);
  for (const changed of [{ digest: "sha256:bad" }, { providerAppId: subject }, { version: "2.0.0" }, { state: "revoked" }]) {
    const f = fixture({ discover: async () => ({ items: [{ ...item, ...changed }] }) });
    await assert.rejects(f.lookup(input), { code: "referral_capability_unavailable" });
    assert.equal(f.calls.some(call => call[0] === "execute"), false);
  }
});
test("bounds discovery and cancellation without submitting a new execution", async () => {
  const f = fixture({ discover: async () => ({ items: [], nextCursor: "loop" }) });
  await assert.rejects(f.lookup(input), { code: "invalid_core_response" });
  const cancel = new AbortController(); cancel.abort();
  const stopped = fixture();
  await assert.rejects(stopped.lookup(input, cancel.signal), { code: "referral_timeout" });
  assert.equal(stopped.calls.length, 0);
});
test("keeps consent, access denial, timeout and provider failures distinct", async () => {
  for (const [error, code] of [
    [{ code: "subject_consent_required", status: 403 }, "subject_consent_required"],
    [{ status: 403 }, "referral_access_denied"], [{ status: 401 }, "core_unavailable"],
    [{ name: "TimeoutError" }, "referral_timeout"],
  ]) await assert.rejects(fixture({ execute: async () => { throw error; } }).lookup(input), { code });
  for (const [result, code] of [
    [{ state: "failed", error: "provider_failed" }, "referral_provider_failed"],
    [{ state: "failed", error: "subject_consent_required" }, "subject_consent_required"],
    [{ state: "timed_out" }, "referral_timeout"], [{ state: "outcome_unknown" }, "referral_provider_failed"],
  ]) await assert.rejects(fixture({ waitForExecution: async () => result }).lookup(input), { code });
});
test("refuses invalid output, wrong referral, unknown urgency and invalid dates", async () => {
  for (const changed of [{ diagnosis: "private" }, { referralId: "OTHER" }, { urgency: "nonsense" }, { issuedAt: "x".repeat(24) }]) {
    await assert.rejects(fixture({ waitForExecution: async () => ({ state: "succeeded", output: { ...output, ...changed } }) }).lookup(input), { code: "invalid_referral_output" });
  }
});
test("missing Core configuration fails explicitly", async () => {
  await assert.rejects(createReferralLookup({ junctura: null })(input), { code: "referrals_not_configured" });
});

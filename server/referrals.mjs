// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { buildManifest, getContract, validateValue } from "@junctura/health-contracts";

const contract = getContract("referral-summary");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
export class ReferralError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function validateLookup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "patientSubject,referralId" ||
      typeof body.patientSubject !== "string" || typeof body.referralId !== "string") throw new ReferralError(400, "invalid_lookup");
  const patientSubject = body.patientSubject.trim().toLowerCase();
  const referralId = body.referralId.trim();
  if (!uuid.test(patientSubject) || /[\u0000-\u001f\u007f]/u.test(referralId) || !referralId.isWellFormed() ||
      validateValue(contract.inputSchema, { referralId }).length) throw new ReferralError(400, "invalid_lookup");
  return { patientSubject, referralId };
}
export function createReferralLookup({ junctura, providerAppId, now = () => new Date() }) {
  return async (body, signal) => {
    const { patientSubject, referralId } = validateLookup(body);
    if (!junctura || !uuid.test(providerAppId ?? "")) throw new ReferralError(503, "referrals_not_configured");
    const manifest = buildManifest(contract, providerAppId);
    const digest = `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`;
    try {
      let cursor, selected;
      const cursors = new Set();
      for (let page = 0; page < 20; page++) {
        signal?.throwIfAborted();
        const listing = await junctura.discover({ limit: 10, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(listing.items)) throw new ReferralError(502, "invalid_core_response");
        selected = listing.items.find(item => item.state === "published" && item.capabilityId === manifest.capabilityId &&
          item.providerAppId === providerAppId && item.version === contract.version && item.digest === digest);
        if (selected) break;
        if (!listing.nextCursor) break;
        if (typeof listing.nextCursor !== "string" || cursors.has(listing.nextCursor)) throw new ReferralError(502, "invalid_core_response");
        cursor = listing.nextCursor; cursors.add(cursor);
      }
      if (!selected) throw new ReferralError(403, "referral_capability_unavailable");
      signal?.throwIfAborted();
      const execution = await junctura.execute({ kind: "capability", capability: {
        capabilityId: selected.capabilityId, version: selected.version, manifestDigest: selected.digest,
      } }, { referralId }, undefined, { purpose: "referral_intake", dataSubject: patientSubject });
      if (!uuid.test(execution.executionId ?? "")) throw new ReferralError(502, "invalid_core_response");
      const result = await junctura.waitForExecution(execution.executionId, { timeoutMs: 20000, intervalMs: 500, signal });
      if (result.state !== "succeeded") {
        if (result.error === "subject_consent_required") throw new ReferralError(403, "subject_consent_required");
        if (result.state === "timed_out") throw new ReferralError(504, "referral_timeout");
        if (result.state === "auth_required") throw new ReferralError(503, "core_unavailable");
        throw new ReferralError(502, "referral_provider_failed");
      }
      const output = result.output;
      if (validateValue(contract.outputSchema, output).length || output.referralId !== referralId ||
          !Number.isFinite(Date.parse(output.issuedAt)) || !["routine", "urgent", "emergency"].includes(output.urgency)) {
        throw new ReferralError(502, "invalid_referral_output");
      }
      return { patientSubject, referralId, executionId: execution.executionId, receivedAt: now().toISOString(), referral: output };
    } catch (error) {
      if (error instanceof ReferralError) throw error;
      if (error.code === "subject_consent_required") throw new ReferralError(403, "subject_consent_required");
      if (error.status === 403) throw new ReferralError(403, "referral_access_denied");
      if (["TimeoutError", "AbortError"].includes(error.name)) throw new ReferralError(504, "referral_timeout");
      throw new ReferralError(503, "core_unavailable");
    }
  };
}

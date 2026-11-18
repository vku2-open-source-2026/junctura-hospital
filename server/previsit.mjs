// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import {
  buildManifest,
  getContract,
  validateValue,
} from "@junctura/health-contracts";
export class ExaminationError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const contract = getContract("pre-visit-summary");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const dateOnly = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function validSummary(output) {
  return (
    !validateValue(contract.outputSchema, output).length &&
    Number.isFinite(Date.parse(output.updatedAt)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      output.updatedAt,
    ) &&
    dateOnly(output.updatedAt.slice(0, 10)) &&
    ["male", "female", "other"].includes(output.sex) &&
    output.birthYear <= new Date().getFullYear() &&
    ["recorded", "none-known", "not-recorded"].includes(output.allergyState) &&
    (output.allergyState === "recorded"
      ? output.allergies.length > 0
      : output.allergies.length === 0) &&
    output.allergies.every(
      (item) =>
        item.substance.trim() &&
        ["mild", "moderate", "severe"].includes(item.severity),
    ) &&
    output.chronicConditions.every((item) => dateOnly(item.since)) &&
    output.currentMedications.every((item) => dateOnly(item.since)) &&
    output.recentEncounters.every((item) => dateOnly(item.date))
  );
}
export function createPrevisitLookup({
  junctura,
  providerAppId,
  now = () => new Date(),
  slug = "pre-visit-summary",
}) {
  const contract = getContract(slug);
  return async (patientSubject, signal, emergency) => {
    if (emergency && (!contract.emergencyAccess || !["pre-visit-summary","allergy-list"].includes(slug) || !uuid.test(emergency.operationId ?? "") || typeof emergency.justification !== "string" || [...emergency.justification].length < 10 || [...emergency.justification].length > 500 || !emergency.justification.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(emergency.justification))) throw new ExaminationError(400,"invalid_emergency_access");
    if (!uuid.test(patientSubject ?? ""))
      throw new ExaminationError(400, "invalid_examination");
    if (!junctura || !uuid.test(providerAppId ?? ""))
      throw new ExaminationError(503, "summary_not_configured");
    const manifest = buildManifest(contract, providerAppId);
    const digest = `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`;
    try {
      let cursor, selected;
      const seen = new Set();
      for (let page = 0; page < 20; page++) {
        signal?.throwIfAborted();
        const listing = await junctura.discover({
          limit: 10,
          ...(cursor ? { cursor } : {}),
        });
        if (!Array.isArray(listing.items))
          throw new ExaminationError(502, "invalid_summary");
        selected = listing.items.find(
          (item) =>
            item.state === "published" &&
            item.capabilityId === manifest.capabilityId &&
            item.providerAppId === providerAppId &&
            item.version === contract.version &&
            item.digest === digest,
        );
        if (selected || !listing.nextCursor) break;
        if (
          typeof listing.nextCursor !== "string" ||
          seen.has(listing.nextCursor)
        )
          throw new ExaminationError(502, "invalid_summary");
        cursor = listing.nextCursor;
        seen.add(cursor);
      }
      if (!selected)
        throw new ExaminationError(403, "summary_capability_unavailable");
      signal?.throwIfAborted();
      const execution = await junctura.execute(
        {
          kind: "capability",
          capability: {
            capabilityId: selected.capabilityId,
            version: selected.version,
            manifestDigest: selected.digest,
          },
        },
        {},
        emergency?.operationId,
        { purpose: "treatment", dataSubject: patientSubject, ...(emergency ? {emergency:true,justification:emergency.justification} : {}) },
      );
      if (!uuid.test(execution.executionId ?? ""))
        throw new ExaminationError(502, "invalid_summary");
      if (emergency?.onReserved) await emergency.onReserved(execution.executionId);
      const result = await junctura.waitForExecution(execution.executionId, {
        timeoutMs: 20000,
        intervalMs: 500,
        signal,
      });
      if (result.error === "subject_consent_required")
        throw new ExaminationError(403, "treatment_consent_required");
      if (result.state === "timed_out")
        throw new ExaminationError(504, "summary_timeout");
      if (result.state !== "succeeded")
        throw new ExaminationError(502, "summary_provider_failed");
      if (!(slug === "allergy-list" ? validAllergies(result.output) : validSummary(result.output)))
        throw new ExaminationError(502, "invalid_summary");
      return {
        patientSubject,
        executionId: execution.executionId,
        receivedAt: now().toISOString(),
        summary: result.output,
      };
    } catch (error) {
      if (error instanceof ExaminationError) throw error;
      if (error.code === "emergency_review_backlog") throw new ExaminationError(429,"emergency_review_backlog");
      if (error.code === "subject_consent_required")
        throw new ExaminationError(403, "treatment_consent_required");
      if (error.status === 403)
        throw new ExaminationError(403, "summary_access_denied");
      if (["AbortError", "TimeoutError"].includes(error.name))
        throw new ExaminationError(504, "summary_timeout");
      throw new ExaminationError(503, "summary_unavailable");
    }
  };
}

export function validAllergies(output) {
 return !validateValue(getContract("allergy-list").outputSchema,output).length &&
 Number.isFinite(Date.parse(output.updatedAt)) && dateOnly(output.updatedAt.slice(0,10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(output.updatedAt) &&
 ["recorded","none-known","not-recorded"].includes(output.allergyState) &&
 (output.allergyState==="recorded" ? output.allergies.length>0 : output.allergies.length===0) &&
 output.allergies.every(item=>item.substance.trim() && ["mild","moderate","severe"].includes(item.severity));
}
export const createAllergyLookup = options => createPrevisitLookup({...options,slug:"allergy-list"});

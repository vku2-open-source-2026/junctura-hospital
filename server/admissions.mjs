// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { validateLookup, ReferralError } from "./referrals.mjs";
export const COLLECTION = "hospital_admissions_v1";
export const WORKFLOW_KEY = "junctura_hospital_intake_v1";
const KIND = "hospital-admission/v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class AdmissionError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
// UUIDv5 namespace is the enrolled Hospital app; the same person/referral keeps the same Core idempotency key.
export function admissionKey(appId, subject, referralId) {
  const bytes = createHash("sha1").update(Buffer.from(appId.replaceAll("-", ""), "hex")).update(JSON.stringify([subject, referralId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function validateAdmission(body, year = new Date().getFullYear()) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "birthYear,identityConfirmed,patientName,patientSubject,referralId,sex") throw new AdmissionError(400, "invalid_admission");
  const input = validateLookup({ patientSubject: body.patientSubject, referralId: body.referralId });
  const name = typeof body.patientName === "string" ? body.patientName.trim() : "";
  if (!name || name.length > 160 || !name.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(name) || body.identityConfirmed !== true ||
      !["male", "female", "unknown"].includes(body.sex) || (body.birthYear !== null && (!Number.isInteger(body.birthYear) || body.birthYear < 1900 || body.birthYear > year))) throw new AdmissionError(400, "invalid_admission");
  return { ...input, patientName: name, birthYear: body.birthYear, sex: body.sex };
}
export function createAdmissions({ junctura, appId, facility, lookupReferral }) {
  // Explicitly one Hospital writer process in this bounded demo. Core owns durable records and workflow reservations.
  let tail = Promise.resolve();
  const serial = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const guard = async fn => {
    if (!junctura || !uuid.test(appId ?? "")) throw new AdmissionError(503, "admissions_not_configured");
    try { return await fn(); } catch (error) {
      if (error instanceof AdmissionError || error instanceof ReferralError) throw error;
      throw new AdmissionError(503, "admissions_unavailable");
    }
  };
  function checked(row) {
    const d = row?.data;
    if (!uuid.test(row?.id ?? "") || d?.kind !== KIND || !uuid.test(d.operationId ?? "") || typeof d.workflowId !== "string" ||
        typeof d.definitionId !== "string" || !["routine", "urgent", "emergency"].includes(d.urgency) ||
        typeof d.patientName !== "string" || !uuid.test(d.patientSubject ?? "") || typeof d.referralId !== "string" ||
        d.operationId !== admissionKey(appId, d.patientSubject, d.referralId)) throw new AdmissionError(502, "invalid_admission_record");
    return row;
  }
  async function records() {
    const listing = await (await junctura.request(`/v2/data/${COLLECTION}?limit=100`)).json();
    if (!Array.isArray(listing.items)) throw new AdmissionError(502, "invalid_admission_record");
    const rows = listing.items.map(checked).sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const unique = new Map();
    for (const row of rows) {
      const old = unique.get(row.data.operationId);
      if (old && old.data.workflowId !== row.data.workflowId) throw new AdmissionError(502, "invalid_admission_record");
      if (!old) unique.set(row.data.operationId, row);
    }
    return { rows: [...unique.values()], atCapacity: listing.items.length >= 100 };
  }
  async function view(row) {
    checked(row);
    const d = row.data;
    const flow = await (await junctura.request(`/v1/workflows/executions/${encodeURIComponent(d.workflowId)}`)).json();
    if (flow.definitionId !== d.definitionId || flow.input?.admissionKey !== d.operationId || !["running", "completed", "cancelled"].includes(flow.status)) throw new AdmissionError(502, "invalid_admission_workflow");
    return { id: row.id, patientSubject: d.patientSubject, patientName: d.patientName, birthYear: d.birthYear, sex: d.sex,
      referralId: d.referralId, fromFacility: d.fromFacility, toFacility: d.toFacility, urgency: d.urgency, admittedAt: row.created_at,
      status: { running: "waiting", completed: "called", cancelled: "cancelled" }[flow.status] };
  }
  async function ownRecord(id) {
    if (!uuid.test(id ?? "")) throw new AdmissionError(400, "invalid_admission_id");
    try { return checked(await junctura.getRecord(COLLECTION, id)); }
    catch (error) { if (error.status === 404) throw new AdmissionError(404, "admission_not_found"); throw error; }
  }
  return {
    list: () => guard(async () => {
      const { rows, atCapacity } = await records(); const items = [];
      // Bounded batches protect the Core engine from a 100-request burst.
      for (let i = 0; i < rows.length; i += 5) items.push(...await Promise.all(rows.slice(i,i+5).map(async row => {
        try { return await view(row); } catch { const d = row.data; return { id: row.id, patientSubject: d.patientSubject, patientName: d.patientName,
          birthYear: d.birthYear, sex: d.sex, referralId: d.referralId, urgency: d.urgency, admittedAt: row.created_at, status: "unavailable" }; }
      })));
      const rank = { emergency: 0, urgent: 1, routine: 2 };
      items.sort((a,b) => rank[a.urgency] - rank[b.urgency] || a.admittedAt.localeCompare(b.admittedAt) || a.id.localeCompare(b.id));
      return { items, atCapacity, limit: 100 };
    }),
    admit: (body, actor, signal) => serial(() => guard(async () => {
      const input = validateAdmission(body);
      const key = admissionKey(appId, input.patientSubject, input.referralId);
      const listing = await records();
      const prior = listing.rows.find(row => row.data.operationId === key);
      if (prior) return { admission: await view(prior), created: false };
      if (listing.atCapacity) throw new AdmissionError(409, "admission_capacity_reached");
      const result = await lookupReferral({ patientSubject: input.patientSubject, referralId: input.referralId }, signal);
      if (result.referral.toFacility.normalize("NFC").trim() !== facility.normalize("NFC").trim()) throw new AdmissionError(409, "wrong_destination");
      signal?.throwIfAborted();
      const definitions = await junctura.workflowDefinitions();
      const matches = definitions.items?.filter(item => item.key === WORKFLOW_KEY) ?? [];
      if (matches.length !== 1) throw new AdmissionError(503, "admission_workflow_missing");
      const definitionId = matches[0].id;
      const flow = await junctura.startWorkflow(definitionId, { admissionKey: key }, key);
      if (typeof flow.id !== "string" || flow.definitionId !== definitionId) throw new AdmissionError(502, "invalid_admission_workflow");
      const data = { kind: KIND, operationId: key, ...input, urgency: result.referral.urgency,
        fromFacility: result.referral.fromFacility, toFacility: result.referral.toFacility,
        workflowId: flow.id, definitionId, createdBy: { subject: actor.subject, displayName: actor.displayName } };
      let row;
      try { row = await junctura.createRecord(COLLECTION, data); }
      catch {
        // A lost response may have committed. Reconcile, never blindly retry a write.
        row = (await records()).rows.find(item => item.data.operationId === key);
        if (!row) throw new AdmissionError(503, "admission_pending");
      }
      return { admission: await view(row), created: true };
    })),
    call: id => serial(() => guard(async () => {
      const row = await ownRecord(id); const current = await view(row);
      if (current.status === "cancelled") throw new AdmissionError(409, "admission_cancelled");
      if (current.status === "waiting") await (await junctura.request(`/v1/workflows/executions/${encodeURIComponent(row.data.workflowId)}/complete`, { method: "POST", json: {} })).json();
      return { admission: await view(row) };
    })),
  };
}

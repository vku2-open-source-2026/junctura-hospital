// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { ExaminationError } from "./previsit.mjs";
import { AdmissionError } from "./admissions.mjs";
export const NOTES = "hospital_exam_notes_v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exact = (body, keys) =>
  body &&
  typeof body === "object" &&
  !Array.isArray(body) &&
  Object.keys(body).sort().join(",") === keys.sort().join(",");
const text = (value, max, required = true) =>
  typeof value === "string" &&
  value.isWellFormed() &&
  value.length <= max &&
  (!required || value.trim().length > 0) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export function validateNote(body) {
  if (
    !exact(body, [
      "admissionId",
      "requestId",
      "reason",
      "findings",
      "diagnosis",
      "plan",
    ]) ||
    !uuid.test(body.admissionId ?? "") ||
    !uuid.test(body.requestId ?? "") ||
    !text(body.reason, 240) ||
    !text(body.findings, 1200) ||
    !text(body.plan, 1000) ||
    !exact(body.diagnosis, ["code", "name"]) ||
    !text(body.diagnosis.code, 16, false) ||
    !text(body.diagnosis.name, 160)
  )
    throw new ExaminationError(400, "invalid_note");
  return {
    admissionId: body.admissionId,
    requestId: body.requestId,
    reason: body.reason.trim(),
    findings: body.findings.trim(),
    diagnosis: {
      code: body.diagnosis.code.trim(),
      name: body.diagnosis.name.trim(),
    },
    plan: body.plan.trim(),
  };
}
const same = (a, b) =>
  ["admissionId", "requestId", "reason", "findings", "plan"].every(
    (key) => a[key] === b[key],
  ) &&
  a.diagnosis.code === b.diagnosis.code &&
  a.diagnosis.name === b.diagnosis.name;
export function createExaminations({ junctura, admissions, lookupSummary }) {
  let tail = Promise.resolve();
  const serial = (fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  const guard = async (fn) => {
    try {
      if (!junctura)
        throw new ExaminationError(503, "examinations_not_configured");
      return await fn();
    } catch (error) {
      if (error instanceof ExaminationError || error instanceof AdmissionError)
        throw error;
      throw new ExaminationError(503, "examinations_unavailable");
    }
  };
  async function patient(body) {
    if (!exact(body, ["admissionId"]) || !uuid.test(body.admissionId ?? ""))
      throw new ExaminationError(400, "invalid_examination");
    const admission = await admissions.get(body.admissionId);
    if (admission.status !== "called")
      throw new ExaminationError(409, "patient_not_called");
    return admission;
  }
  function checked(row) {
    if (
      !uuid.test(row?.id ?? "") ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      row.data?.kind !== "hospital-exam-note/v1" ||
      !uuid.test(row.data.patientSubject ?? "") ||
      !text(row.data.createdBy?.subject, 160) ||
      !text(row.data.createdBy?.displayName, 160)
    )
      throw new ExaminationError(502, "invalid_note_record");
    validateNote(
      Object.fromEntries(
        [
          "admissionId",
          "requestId",
          "reason",
          "findings",
          "diagnosis",
          "plan",
        ].map((key) => [key, row.data[key]]),
      ),
    );
    return row;
  }
  async function records() {
    const result = await (
      await junctura.request(`/v2/data/${NOTES}?limit=100`)
    ).json();
    if (!Array.isArray(result.items))
      throw new ExaminationError(502, "invalid_note_record");
    const unique = new Map();
    for (const row of result.items.map(checked)) {
      const prior = unique.get(row.data.requestId);
      if (
        prior &&
        (!same(prior.data, row.data) ||
          prior.data.patientSubject !== row.data.patientSubject ||
          prior.data.createdBy.subject !== row.data.createdBy.subject)
      )
        throw new ExaminationError(502, "invalid_note_record");
      if (!prior || row.created_at < prior.created_at)
        unique.set(row.data.requestId, row);
    }
    return {
      rows: [...unique.values()],
      atCapacity: result.items.length >= 100,
    };
  }
  const view = (row) => ({
    id: row.id,
    createdAt: row.created_at,
    ...Object.fromEntries(
      [
        "admissionId",
        "requestId",
        "reason",
        "findings",
        "diagnosis",
        "plan",
        "createdBy",
      ].map((key) => [key, row.data[key]]),
    ),
  });
  return {
    open: (body) =>
      guard(async () => {
        const admission = await patient(body);
        const result = await records();
        if (
          result.rows.some(
            (row) =>
              row.data.admissionId === admission.id &&
              row.data.patientSubject !== admission.patientSubject,
          )
        )
          throw new ExaminationError(502, "invalid_note_record");
        return {
          admission,
          notes: result.rows
            .filter((row) => row.data.admissionId === admission.id)
            .sort(
              (a, b) =>
                b.created_at.localeCompare(a.created_at) ||
                b.id.localeCompare(a.id),
            )
            .map(view),
          atCapacity: result.atCapacity,
        };
      }),
    summary: (body, signal) =>
      guard(async () => {
        const admission = await patient(body);
        return {
          ...(await lookupSummary(admission.patientSubject, signal)),
          admissionId: admission.id,
          source: admission.fromFacility,
        };
      }),
    save: (body, actor) =>
      serial(() =>
        guard(async () => {
          const input = validateNote(body);
          const admission = await patient({ admissionId: input.admissionId });
          const result = await records();
          const prior = result.rows.find(
            (row) => row.data.requestId === input.requestId,
          );
          if (prior) {
            if (
              !same(prior.data, input) ||
              prior.data.createdBy.subject !== actor.subject ||
              prior.data.patientSubject !== admission.patientSubject
            )
              throw new ExaminationError(409, "note_request_conflict");
            return { note: view(prior), created: false };
          }
          if (result.atCapacity)
            throw new ExaminationError(409, "note_capacity_reached");
          const data = {
            kind: "hospital-exam-note/v1",
            ...input,
            patientSubject: admission.patientSubject,
            createdBy: {
              subject: actor.subject,
              displayName: actor.displayName,
            },
          };
          let row;
          try {
            row = checked(await junctura.createRecord(NOTES, data));
          } catch {
            row = (await records()).rows.find(
              (item) => item.data.requestId === input.requestId,
            );
            if (!row) throw new ExaminationError(503, "note_pending");
            if (
              !same(row.data, input) ||
              row.data.createdBy.subject !== actor.subject ||
              row.data.patientSubject !== admission.patientSubject
            )
              throw new ExaminationError(409, "note_request_conflict");
          }
          return { note: view(row), created: true };
        }),
      ),
  };
}

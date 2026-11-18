// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { getContract, validateValue } from "@junctura/health-contracts";
import { ExaminationError } from "./previsit.mjs";
import { AdmissionError } from "./admissions.mjs";
export const COLLECTION = "hospital_prescriptions_v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const contract = getContract("prescription-verify");
export class PrescriptionError extends Error {
  constructor(status, code, check) {
    super(code);
    this.status = status;
    this.code = code;
    this.check = check;
  }
}
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === keys.sort().join(",");
const text = (v, max) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  v.isWellFormed() &&
  !/[\u0000-\u001f\u007f]/u.test(v);
export async function loadPrescriptionCatalog(healthDir) {
  const { HOSPITAL_DRUGS } = await import(
    pathToFileURL(resolve(healthDir, "seed/catalog.mjs")).href
  );
  return HOSPITAL_DRUGS.map((item) => ({
    name: item.name,
    strength: item.strength,
  }));
}
export function validatePrescription(body, catalog, issue = false) {
  const keys = [
    "admissionId",
    "noteId",
    "items",
    "validDays",
    ...(issue ? ["requestId", "reviewConfirmed", "overrideReason"] : []),
  ];
  if (
    !exact(body, keys) ||
    !uuid.test(body.admissionId ?? "") ||
    !uuid.test(body.noteId ?? "") ||
    !Number.isInteger(body.validDays) ||
    body.validDays < 1 ||
    body.validDays > 30 ||
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 20
  )
    throw new PrescriptionError(400, "invalid_prescription");
  const items = body.items.map((item) => {
    if (
      !exact(item, ["name", "strength", "quantity", "instructions"]) ||
      validateValue(contract.outputSchema.properties.items.items, item)
        .length ||
      !text(item.name, 160) ||
      !text(item.strength, 80) ||
      !text(item.instructions, 240) ||
      !catalog.some(
        (entry) => entry.name === item.name && entry.strength === item.strength,
      )
    )
      throw new PrescriptionError(400, "invalid_prescription");
    return {
      name: item.name,
      strength: item.strength,
      quantity: item.quantity,
      instructions: item.instructions.trim(),
    };
  });
  if (
    new Set(items.map((item) => item.name + "|" + item.strength)).size !==
    items.length
  )
    throw new PrescriptionError(400, "duplicate_medicine");
  const value = {
    admissionId: body.admissionId,
    noteId: body.noteId,
    items,
    validDays: body.validDays,
  };
  if (issue) {
    if (
      !uuid.test(body.requestId ?? "") ||
      body.reviewConfirmed !== true ||
      typeof body.overrideReason !== "string" ||
      (body.overrideReason !== "" && !text(body.overrideReason, 500))
    )
      throw new PrescriptionError(400, "invalid_prescription");
    Object.assign(value, {
      requestId: body.requestId,
      reviewConfirmed: true,
      overrideReason: body.overrideReason.trim(),
    });
  }
  return value;
}
const fold = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
// Limited demo rule, not a clinical decision system. NHS source and boundaries documented in README.
export function allergyConflicts(items, allergies) {
  const result = [];
  for (const item of items) {
    const drug = fold(item.name);
    for (const allergy of allergies) {
      const allergen = fold(allergy.substance);
      if (
        drug.includes(allergen) ||
        allergen.includes(drug) ||
        (allergen === "penicillin" && drug === "amoxicillin")
      )
        result.push({
          medicine: item.name,
          allergen: allergy.substance,
          severity: allergy.severity,
        });
    }
  }
  return result;
}
export const prescriptionCode = (id) =>
  `DT-${BigInt("0x" + id.replaceAll("-", ""))
    .toString(36)
    .toUpperCase()
    .padStart(25, "0")}`;
const same = (a, b) =>
  JSON.stringify([
    a.admissionId,
    a.noteId,
    a.items,
    a.validDays,
    a.overrideReason,
  ]) ===
  JSON.stringify([
    b.admissionId,
    b.noteId,
    b.items,
    b.validDays,
    b.overrideReason,
  ]);
export function createPrescriptions({
  junctura,
  examinations,
  lookupAllergies,
  catalog = [],
  now = () => new Date(),
}) {
  let tail = Promise.resolve();
  const serial = (fn) => {
    const p = tail.then(fn);
    tail = p.catch(() => {});
    return p;
  };
  const guard = async (fn) => {
    try {
      if (!junctura)
        throw new PrescriptionError(503, "prescriptions_not_configured");
      return await fn();
    } catch (e) {
      if (
        e instanceof PrescriptionError ||
        e instanceof ExaminationError ||
        e instanceof AdmissionError
      )
        throw e;
      throw new PrescriptionError(503, "prescriptions_unavailable");
    }
  };
  function checked(row) {
    const d = row?.data;
    if (
      !uuid.test(row?.id ?? "") ||
      d?.kind !== "hospital-prescription/v1" ||
      !uuid.test(d.patientSubject ?? "") ||
      !uuid.test(d.requestId ?? "") ||
      d.prescriptionCode !== prescriptionCode(d.requestId) ||
      !text(d.patientName, 160) ||
      !text(d.createdBy?.subject, 160) ||
      !text(d.createdBy?.displayName, 160) ||
      !Number.isFinite(Date.parse(d.issuedAt)) ||
      !Number.isFinite(Date.parse(d.expiresAt)) ||
      d.dispensed !== false
    )
      throw new PrescriptionError(502, "invalid_prescription_record");
    try {
      validatePrescription(
        Object.fromEntries(
          [
            "admissionId",
            "noteId",
            "items",
            "validDays",
            "requestId",
            "reviewConfirmed",
            "overrideReason",
          ].map((k) => [k, d[k]]),
        ),
        catalog,
        true,
      );
    } catch {
      throw new PrescriptionError(502, "invalid_prescription_record");
    }
    return row;
  }
  async function records() {
    const result = await (
      await junctura.request(`/v2/data/${COLLECTION}?limit=100`)
    ).json();
    if (!Array.isArray(result.items))
      throw new PrescriptionError(502, "invalid_prescription_record");
    const byId = new Map();
    for (const row of result.items.map(checked)) {
      const old = byId.get(row.data.requestId);
      if (
        old &&
        (!same(old.data, row.data) ||
          old.data.createdBy.subject !== row.data.createdBy.subject ||
          old.data.patientSubject !== row.data.patientSubject)
      )
        throw new PrescriptionError(502, "invalid_prescription_record");
      if (!old) byId.set(row.data.requestId, row);
    }
    return { rows: [...byId.values()], atCapacity: result.items.length >= 100 };
  }
  const view = (row) => {
    const d = row.data;
    return {
      id: row.id,
      requestId: d.requestId,
      admissionId: d.admissionId,
      noteId: d.noteId,
      patientSubject: d.patientSubject,
      patientName: d.patientName,
      birthYear: d.birthYear,
      sex: d.sex,
      prescriptionCode: d.prescriptionCode,
      issuedAt: d.issuedAt,
      expiresAt: d.expiresAt,
      items: d.items,
      createdBy: d.createdBy,
      dispensed: d.dispensed,
      expired: Date.parse(d.expiresAt) <= now().getTime(),
    };
  };
  async function encounter(admissionId, noteId) {
    const result = await examinations.open({ admissionId });
    if (!result.notes.some((note) => note.id === noteId))
      throw new PrescriptionError(409, "examination_note_required");
    return result.admission;
  }
  async function assess(input, signal) {
    const admission = await encounter(input.admissionId, input.noteId);
    const value = await lookupAllergies(admission.patientSubject, signal);
    const allergy = value.summary;
    const conflicts = allergyConflicts(input.items, allergy.allergies);
    const age = now().getTime() - Date.parse(allergy.updatedAt);
    if (age < -300000) throw new PrescriptionError(502, "invalid_summary");
    const stale = age > 365 * 86400000;
    return {
      admission,
      check: {
        patientSubject: admission.patientSubject,
        source: admission.fromFacility,
        executionId: value.executionId,
        checkedAt: value.receivedAt,
        allergy,
        conflicts,
        stale,
        reviewRequired:
          conflicts.length > 0 ||
          allergy.allergyState === "not-recorded" ||
          stale,
      },
    };
  }
  return {
    catalog: () => catalog,
    list: () =>
      guard(async () => {
        const result = await records();
        return {
          items: result.rows
            .sort((a, b) => b.data.issuedAt.localeCompare(a.data.issuedAt))
            .map(view),
          atCapacity: result.atCapacity,
        };
      }),
    open: (body) =>
      guard(async () => {
        if (!exact(body, ["admissionId"]) || !uuid.test(body.admissionId ?? ""))
          throw new PrescriptionError(400, "invalid_prescription");
        const examination = await examinations.open(body);
        const result = await records();
        const own = result.rows.filter(
          (row) => row.data.admissionId === body.admissionId,
        );
        if (
          own.some(
            (row) =>
              row.data.patientSubject !== examination.admission.patientSubject,
          )
        )
          throw new PrescriptionError(502, "invalid_prescription_record");
        return {
          ...examination,
          prescriptions: own.map(view),
          catalog,
          atCapacity: result.atCapacity,
        };
      }),
    check: (body, signal) =>
      guard(async () => {
        const input = validatePrescription(body, catalog);
        return (await assess(input, signal)).check;
      }),
    issue: (body, actor, signal) =>
      serial(() =>
        guard(async () => {
          const input = validatePrescription(body, catalog, true);
          const admission = await encounter(input.admissionId, input.noteId);
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
              throw new PrescriptionError(409, "prescription_request_conflict");
            return { prescription: view(prior), created: false };
          }
          if (result.atCapacity)
            throw new PrescriptionError(409, "prescription_capacity_reached");
          const { check } = await assess(input, signal);
          if (check.reviewRequired && input.overrideReason.length < 10)
            throw new PrescriptionError(409, "allergy_review_required", check);
          signal?.throwIfAborted();
          const issuedAt = now().toISOString(),
            expiresAt = new Date(
              Date.parse(issuedAt) + input.validDays * 86400000,
            ).toISOString();
          const data = {
            kind: "hospital-prescription/v1",
            ...input,
            patientSubject: admission.patientSubject,
            patientName: admission.patientName,
            birthYear: admission.birthYear,
            sex: admission.sex,
            prescriptionCode: prescriptionCode(input.requestId),
            issuedAt,
            expiresAt,
            dispensed: false,
            createdBy: {
              subject: actor.subject,
              displayName: actor.displayName,
            },
            allergyReview: {
              executionId: check.executionId,
              updatedAt: check.allergy.updatedAt,
              state: check.allergy.allergyState,
              checkedAt: check.checkedAt,
              conflicts: check.conflicts,
              stale: check.stale,
            },
          };
          let row;
          try {
            row = checked(await junctura.createRecord(COLLECTION, data));
          } catch {
            row = (await records()).rows.find(
              (item) => item.data.requestId === input.requestId,
            );
            if (!row) throw new PrescriptionError(503, "prescription_pending");
            if (
              !same(row.data, input) ||
              row.data.createdBy.subject !== actor.subject
            )
              throw new PrescriptionError(409, "prescription_request_conflict");
          }
          return { prescription: view(row), created: true };
        }),
      ),
    verify: (patientSubject, code) =>
      guard(async () => {
        const result = await records();
        if (result.atCapacity)
          throw new PrescriptionError(503, "verification_capacity_reached");
        const row = result.rows.find(
          (row) =>
            row.data.patientSubject === patientSubject &&
            row.data.prescriptionCode === code,
        );
        const epoch = "1970-01-01T00:00:00.000Z";
        if (!row)
          return {
            valid: false,
            issuedAt: epoch,
            expiresAt: epoch,
            items: [],
            dispensed: false,
          };
        const d = row.data,
          valid =
            Date.parse(d.issuedAt) <= now().getTime() &&
            Date.parse(d.expiresAt) > now().getTime();
        return {
          valid,
          issuedAt: d.issuedAt,
          expiresAt: d.expiresAt,
          items: valid ? d.items : [],
          dispensed: d.dispensed,
        };
      }),
  };
}

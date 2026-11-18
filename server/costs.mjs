// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { ExaminationError } from "./previsit.mjs";
import { AdmissionError } from "./admissions.mjs";
export const COLLECTION = "hospital_costs_v1";
const MAX = 1000000000000,
  uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class CostError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === keys.sort().join(",");
const text = (v, max) =>
  typeof v === "string" &&
  v.isWellFormed() &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(v);
export function calculateCosts(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20)
    throw new CostError(400, "invalid_cost_items");
  let total = 0;
  const normalized = items.map((item) => {
    if (
      !exact(item, ["description", "quantity", "unitPriceVnd"]) ||
      !text(item.description, 160) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 1000 ||
      !Number.isSafeInteger(item.unitPriceVnd) ||
      item.unitPriceVnd < 0 ||
      item.unitPriceVnd > MAX
    )
      throw new CostError(400, "invalid_cost_items");
    const amountVnd = item.quantity * item.unitPriceVnd;
    total += amountVnd;
    if (!Number.isSafeInteger(total) || total > MAX)
      throw new CostError(400, "invalid_cost_total");
    return {
      description: item.description.trim(),
      quantity: item.quantity,
      unitPriceVnd: item.unitPriceVnd,
    };
  });
  return { items: normalized, amountVnd: total };
}
export function validateCost(body) {
  if (
    !exact(body, [
      "admissionId",
      "noteId",
      "requestId",
      "items",
      "confirmed",
    ]) ||
    !uuid.test(body.admissionId ?? "") ||
    !uuid.test(body.noteId ?? "") ||
    !uuid.test(body.requestId ?? "") ||
    body.confirmed !== true
  )
    throw new CostError(400, "invalid_cost");
  return {
    admissionId: body.admissionId,
    noteId: body.noteId,
    requestId: body.requestId,
    confirmed: true,
    ...calculateCosts(body.items),
  };
}
export const claimCode = (id) =>
  `HS-${BigInt("0x" + id.replaceAll("-", ""))
    .toString(36)
    .toUpperCase()
    .padStart(25, "0")}`;
const same = (a, b) =>
  a.admissionId === b.admissionId &&
  a.noteId === b.noteId &&
  JSON.stringify(a.items) === JSON.stringify(b.items) &&
  a.amountVnd === b.amountVnd;
export function createCosts({
  junctura,
  examinations,
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
      if (!junctura) throw new CostError(503, "costs_not_configured");
      return await fn();
    } catch (e) {
      if (
        e instanceof CostError ||
        e instanceof ExaminationError ||
        e instanceof AdmissionError
      )
        throw e;
      throw new CostError(503, "costs_unavailable");
    }
  };
  function checked(row) {
    const d = row?.data;
    if (
      !uuid.test(row?.id ?? "") ||
      d?.kind !== "hospital-cost/v1" ||
      !uuid.test(d.patientSubject ?? "") ||
      !uuid.test(d.requestId ?? "") ||
      d.claimId !== claimCode(d.requestId) ||
      !text(d.patientName, 160) ||
      !text(d.createdBy?.subject, 160) ||
      !text(d.createdBy?.displayName, 160) ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      d.insuranceStatus !== "not-reported"
    )
      throw new CostError(502, "invalid_cost_record");
    try {
      const input = validateCost(
        Object.fromEntries(
          ["admissionId", "noteId", "requestId", "items", "confirmed"].map(
            (key) => [key, d[key]],
          ),
        ),
      );
      if (input.amountVnd !== d.amountVnd) throw Error();
    } catch {
      throw new CostError(502, "invalid_cost_record");
    }
    return row;
  }
  async function records() {
    const result = await (
      await junctura.request(`/v2/data/${COLLECTION}?limit=100`)
    ).json();
    if (!Array.isArray(result.items))
      throw new CostError(502, "invalid_cost_record");
    const found = new Map();
    for (const row of result.items.map(checked)) {
      const old = found.get(row.data.requestId);
      if (
        old &&
        (!same(old.data, row.data) ||
          old.data.patientSubject !== row.data.patientSubject ||
          old.data.createdBy.subject !== row.data.createdBy.subject)
      )
        throw new CostError(502, "invalid_cost_record");
      if (!old) found.set(row.data.requestId, row);
    }
    return {
      rows: [...found.values()],
      atCapacity: result.items.length >= 100,
    };
  }
  const view = (row) => ({
    id: row.id,
    createdAt: row.created_at,
    ...Object.fromEntries(
      [
        "admissionId",
        "noteId",
        "requestId",
        "patientSubject",
        "patientName",
        "birthYear",
        "sex",
        "claimId",
        "items",
        "amountVnd",
        "insuranceStatus",
        "createdBy",
      ].map((k) => [k, row.data[k]]),
    ),
  });
  return {
    list: () =>
      guard(async () => {
        const result = await records();
        return {
          items: result.rows
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map(view),
          atCapacity: result.atCapacity,
        };
      }),
    open: (body) =>
      guard(async () => {
        if (!exact(body, ["admissionId"]) || !uuid.test(body.admissionId ?? ""))
          throw new CostError(400, "invalid_cost");
        const examination = await examinations.open(body);
        const result = await records(),
          rows = result.rows.filter(
            (v) => v.data.admissionId === body.admissionId,
          );
        if (
          rows.some(
            (v) =>
              v.data.patientSubject !== examination.admission.patientSubject,
          )
        )
          throw new CostError(502, "invalid_cost_record");
        return {
          ...examination,
          costs: rows.map(view),
          atCapacity: result.atCapacity,
        };
      }),
    create: (body, actor) =>
      serial(() =>
        guard(async () => {
          const input = validateCost(body),
            exam = await examinations.open({ admissionId: input.admissionId });
          if (!exam.notes.some((v) => v.id === input.noteId))
            throw new CostError(409, "cost_note_required");
          const result = await records(),
            prior = result.rows.find(
              (v) => v.data.requestId === input.requestId,
            );
          if (prior) {
            if (
              !same(prior.data, input) ||
              prior.data.patientSubject !== exam.admission.patientSubject ||
              prior.data.createdBy.subject !== actor.subject
            )
              throw new CostError(409, "cost_request_conflict");
            return { cost: view(prior), created: false };
          }
          if (result.atCapacity)
            throw new CostError(409, "cost_capacity_reached");
          const a = exam.admission,
            data = {
              kind: "hospital-cost/v1",
              ...input,
              patientSubject: a.patientSubject,
              patientName: a.patientName,
              birthYear: a.birthYear,
              sex: a.sex,
              claimId: claimCode(input.requestId),
              insuranceStatus: "not-reported",
              createdBy: {
                subject: actor.subject,
                displayName: actor.displayName,
              },
            };
          let row;
          try {
            row = checked(await junctura.createRecord(COLLECTION, data));
          } catch {
            row = (await records()).rows.find(
              (v) => v.data.requestId === input.requestId,
            );
            if (!row) throw new CostError(503, "cost_pending");
            if (
              !same(row.data, input) ||
              row.data.patientSubject !== a.patientSubject ||
              row.data.createdBy.subject !== actor.subject
            )
              throw new CostError(409, "cost_request_conflict");
          }
          return { cost: view(row), created: true };
        }),
      ),
    verify: (patientSubject, id, amount) =>
      guard(async () => {
        const result = await records();
        if (result.atCapacity)
          throw new CostError(503, "cost_verification_capacity");
        const row = result.rows.find(
          (v) =>
            v.data.patientSubject === patientSubject && v.data.claimId === id,
        );
        return {
          matches: !!row && row.data.amountVnd === amount,
          checkedAt: now().toISOString(),
        };
      }),
  };
}

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createCosts,
  calculateCosts,
  validateCost,
  COLLECTION,
} from "../server/costs.mjs";
const admissionId = randomUUID(),
  noteId = randomUUID(),
  subject = randomUUID(),
  actor = { subject: "doctor", displayName: "Bác sĩ giả lập" };
const input = () => ({
  admissionId,
  noteId,
  requestId: randomUUID(),
  items: [
    { description: "Khoản thử", quantity: 2, unitPriceVnd: 100000 },
    { description: "Khoản bổ sung", quantity: 1, unitPriceVnd: 50000 },
  ],
  confirmed: true,
});
function fixture() {
  const rows = [];
  const state = { lost: false, unavailable: false, notes: [{ id: noteId }] };
  const sdk = {
    request: async (path) => {
      assert.equal(path, `/v2/data/${COLLECTION}?limit=100`);
      if (state.unavailable) throw Error("offline");
      return { json: async () => ({ items: structuredClone(rows) }) };
    },
    createRecord: async (collection, data) => {
      assert.equal(collection, COLLECTION);
      const row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        data: structuredClone(data),
      };
      rows.push(row);
      if (state.lost) {
        state.lost = false;
        throw Error("response lost");
      }
      return structuredClone(row);
    },
  };
  const examinations = {
    open: async (body) => {
      assert.equal(body.admissionId, admissionId);
      return {
        admission: {
          id: admissionId,
          patientSubject: subject,
          patientName: "Người bệnh giả lập",
          birthYear: 1968,
          sex: "male",
        },
        notes: state.notes,
        atCapacity: false,
      };
    },
  };
  return {
    rows,
    state,
    sdk,
    examinations,
    service: createCosts({ junctura: sdk, examinations }),
  };
}
test("cost arithmetic uses integer VND and rejects caller totals, fractions, controls and overflow", () => {
  assert.equal(calculateCosts(input().items).amountVnd, 250000);
  for (const items of [
    [],
    [{ description: "x", quantity: 1.5, unitPriceVnd: 2 }],
    [{ description: "x", quantity: 1, unitPriceVnd: -1 }],
    [{ description: "x", quantity: 1000, unitPriceVnd: 1e12 }],
    [{ description: "x\n", quantity: 1, unitPriceVnd: 1 }],
    [{ description: "x", quantity: 1, unitPriceVnd: 1, amountVnd: 2 }],
  ])
    assert.throws(() => calculateCosts(items));
  assert.throws(() => validateCost({ ...input(), amountVnd: 1 }));
  assert.throws(() => validateCost({ ...input(), confirmed: false }));
  assert.equal(
    calculateCosts([{ description: "x", quantity: 1, unitPriceVnd: 0 }])
      .amountVnd,
    0,
  );
});
test("cost creation derives patient, author and total from owned examination and Core data", async () => {
  const f = fixture(),
    body = input();
  const r = await f.service.create(body, actor);
  assert.equal(r.cost.amountVnd, 250000);
  assert.equal(r.cost.patientSubject, subject);
  assert.deepEqual(r.cost.createdBy, actor);
  assert.equal(r.cost.insuranceStatus, "not-reported");
  assert.match(r.cost.claimId, /^HS-[0-9A-Z]{25}$/);
  assert.equal((await f.service.open({ admissionId })).costs.length, 1);
  f.state.notes = [];
  await assert.rejects(
    f.service.create(input(), actor),
    (e) => e.code === "cost_note_required",
  );
});
test("same request survives duplicate clicks, process restart and lost write response", async () => {
  const f = fixture(),
    body = input();
  f.state.lost = true;
  const results = await Promise.all([
    f.service.create(body, actor),
    f.service.create(body, actor),
  ]);
  assert.equal(f.rows.length, 1);
  assert.equal(results[0].cost.id, results[1].cost.id);
  const restarted = createCosts({
    junctura: f.sdk,
    examinations: f.examinations,
  });
  assert.equal((await restarted.create(body, actor)).created, false);
  await assert.rejects(
    restarted.create(
      {
        ...body,
        items: [{ description: "changed", quantity: 1, unitPriceVnd: 1 }],
      },
      actor,
    ),
    (e) => e.code === "cost_request_conflict",
  );
  await assert.rejects(
    restarted.create(body, { ...actor, subject: "other" }),
    (e) => e.status === 409,
  );
});
test("claim verification only exposes matches and checkedAt with wrong code, amount or subject indistinguishable", async () => {
  const f = fixture(),
    r = await f.service.create(input(), actor);
  for (const [s, id, amount, expected] of [
    [subject, r.cost.claimId, 250000, true],
    [subject, r.cost.claimId, 1, false],
    [randomUUID(), r.cost.claimId, 250000, false],
    [subject, "HS-NOT-FOUND", 250000, false],
  ]) {
    const v = await f.service.verify(s, id, amount);
    assert.deepEqual(Object.keys(v).sort(), ["checkedAt", "matches"]);
    assert.equal(v.matches, expected);
    assert.ok(Number.isFinite(Date.parse(v.checkedAt)));
  }
  f.state.unavailable = true;
  await assert.rejects(
    f.service.verify(subject, r.cost.claimId, 250000),
    (e) => e.status === 503,
  );
});
test("bounded data fails closed at capacity, preserves replay and rejects corrupted or cross-patient links", async () => {
  const f = fixture(),
    body = input(),
    r = await f.service.create(body, actor);
  f.rows.push(...Array.from({ length: 99 }, () => structuredClone(f.rows[0])));
  assert.equal((await f.service.create(body, actor)).created, false);
  await assert.rejects(
    f.service.create(input(), actor),
    (e) => e.code === "cost_capacity_reached",
  );
  await assert.rejects(
    f.service.verify(subject, r.cost.claimId, 250000),
    (e) => e.status === 503,
  );
  f.rows.splice(1);
  f.rows[0].data.patientSubject = randomUUID();
  await assert.rejects(
    f.service.open({ admissionId }),
    (e) => e.code === "invalid_cost_record",
  );
  f.rows[0].data.amountVnd = 1;
  await assert.rejects(
    f.service.list(),
    (e) => e.code === "invalid_cost_record",
  );
});

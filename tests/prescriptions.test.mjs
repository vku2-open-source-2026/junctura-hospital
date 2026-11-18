// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createPrescriptions,
  validatePrescription,
  prescriptionCode,
  COLLECTION,
} from "../server/prescriptions.mjs";
import { ExaminationError } from "../server/previsit.mjs";
const admissionId = "11111111-1111-4111-8111-111111111111",
  noteId = "22222222-2222-4222-8222-222222222222",
  subject = "33333333-3333-4333-8333-333333333333";
const catalog = [
    { name: "Amoxicillin", strength: "500 mg" },
    { name: "Clopidogrel", strength: "75 mg" },
  ],
  actor = { subject: "doctor", displayName: "Bác sĩ giả lập" };
const draft = () => ({
  admissionId,
  noteId,
  items: [
    { ...catalog[0], quantity: 1, instructions: "Nội dung kiểm thử giả lập" },
  ],
  validDays: 7,
});
const issue = () => ({
  ...draft(),
  requestId: randomUUID(),
  reviewConfirmed: true,
  overrideReason: "",
});
function fixture() {
  const rows = [],
    calls = [];
  let time = new Date("2026-11-18T08:00:00.000Z");
  const state = {
    consent: true,
    allergyState: "none-known",
    allergies: [],
    created: "ok",
    note: true,
    updatedAt: "2026-11-18T07:00:00.000Z",
  };
  const sdk = {
    request: async (path) => {
      assert.equal(path, `/v2/data/${COLLECTION}?limit=100`);
      return { json: async () => ({ items: structuredClone(rows) }) };
    },
    createRecord: async (collection, data) => {
      assert.equal(collection, COLLECTION);
      calls.push(["write", data]);
      if (state.created === "before") {
        state.created = "ok";
        throw Error("lost");
      }
      const row = {
        id: randomUUID(),
        created_at: time.toISOString(),
        data: structuredClone(data),
      };
      rows.push(row);
      if (state.created === "after") {
        state.created = "ok";
        throw Error("lost");
      }
      return row;
    },
  };
  const build = () =>
    createPrescriptions({
      junctura: sdk,
      catalog,
      now: () => time,
      examinations: {
        open: async (body) => {
          if (body.admissionId !== admissionId) throw Error("not owned");
          return {
            admission: {
              id: admissionId,
              patientSubject: subject,
              patientName: "Người bệnh giả lập",
              birthYear: 1968,
              sex: "male",
              fromFacility: "Trạm giả lập",
            },
            notes: state.note ? [{ id: noteId }] : [],
          };
        },
      },
      lookupAllergies: async (patient) => {
        assert.equal(patient, subject);
        calls.push(["allergy"]);
        if (!state.consent)
          throw new ExaminationError(403, "treatment_consent_required");
        return {
          executionId: randomUUID(),
          receivedAt: time.toISOString(),
          summary: {
            allergyState: state.allergyState,
            allergies: state.allergies,
            updatedAt: state.updatedAt,
          },
        };
      },
    });
  return {
    service: build(),
    build,
    state,
    rows,
    calls,
    advance: () => (time = new Date("2026-12-20T08:00:00.000Z")),
  };
}
test("validates catalog membership, quantity, duplicates, note and explicit review", () => {
  for (const changed of [
    { items: [] },
    { items: [{ ...draft().items[0], name: "Arbitrary drug" }] },
    { items: [{ ...draft().items[0], quantity: 0 }] },
    { validDays: 31 },
    { noteId: "wrong" },
    { reviewConfirmed: false },
    { patientSubject: subject },
  ])
    assert.throws(
      () => validatePrescription({ ...issue(), ...changed }, catalog, true),
      { code: "invalid_prescription" },
    );
  assert.throws(
    () =>
      validatePrescription(
        { ...draft(), items: [...draft().items, ...draft().items] },
        catalog,
      ),
    { code: "duplicate_medicine" },
  );
});
test("requires a saved owned examination and consent before writes", async () => {
  const f = fixture();
  f.state.note = false;
  await assert.rejects(f.service.issue(issue(), actor), {
    code: "examination_note_required",
  });
  assert.equal(f.calls.length, 0);
  f.state.note = true;
  f.state.consent = false;
  await assert.rejects(f.service.issue(issue(), actor), {
    code: "treatment_consent_required",
  });
  assert.equal(f.rows.length, 0);
});
test("Penicillin/Amoxicillin conflict is rechecked at issue and requires a recorded reason", async () => {
  const f = fixture(),
    input = issue();
  await f.service.check(draft());
  f.state.allergyState = "recorded";
  f.state.allergies = [
    { substance: "Penicillin", severity: "severe", reaction: "Giả lập" },
  ];
  await assert.rejects(
    f.service.issue(input, actor),
    (e) =>
      e.code === "allergy_review_required" &&
      e.check.conflicts[0].severity === "severe",
  );
  assert.equal(f.rows.length, 0);
  const value = await f.service.issue(
    { ...input, overrideReason: "Kiểm thử xác nhận có lý do, dữ liệu giả lập" },
    actor,
  );
  assert.equal(value.created, true);
  assert.equal(f.rows[0].data.allergyReview.conflicts.length, 1);
  assert.equal(f.calls.filter((v) => v[0] === "allergy").length, 3);
});
test("not-recorded and stale allergy facts never become a clean allergy check", async () => {
  for (const mode of ["unknown", "stale"]) {
    const f = fixture();
    if (mode === "unknown") f.state.allergyState = "not-recorded";
    else f.state.updatedAt = "2024-01-01T00:00:00.000Z";
    const result = await f.service.check(draft());
    assert.equal(result.reviewRequired, true);
    await assert.rejects(f.service.issue(issue(), actor), {
      code: "allergy_review_required",
    });
  }
});
test("one stable prescription after repeated clicks/restart, changed content or actor conflicts", async () => {
  const f = fixture(),
    body = issue();
  const [a, b] = await Promise.all([
    f.service.issue(body, actor),
    f.service.issue(body, actor),
  ]);
  assert.equal(a.prescription.id, b.prescription.id);
  assert.equal(f.rows.length, 1);
  f.state.consent = false;
  assert.equal((await f.build().issue(body, actor)).created, false);
  await assert.rejects(f.service.issue({ ...body, validDays: 8 }, actor), {
    code: "prescription_request_conflict",
  });
  await assert.rejects(f.service.issue(body, { ...actor, subject: "other" }), {
    code: "prescription_request_conflict",
  });
  assert.equal(
    a.prescription.prescriptionCode,
    prescriptionCode(body.requestId),
  );
  assert.ok(a.prescription.prescriptionCode.length <= 32);
});
test("lost responses reconcile by request ID without a new prescription code", async () => {
  const f = fixture(),
    body = issue();
  f.state.created = "after";
  assert.equal((await f.service.issue(body, actor)).created, true);
  assert.equal(f.rows.length, 1);
  const g = fixture();
  g.state.created = "before";
  await assert.rejects(g.service.issue(body, actor), {
    code: "prescription_pending",
  });
  assert.equal(
    (await g.service.issue(body, actor)).prescription.prescriptionCode,
    prescriptionCode(body.requestId),
  );
  assert.equal(g.rows.length, 1);
});
test("verification checks the ticket subject, expiration and exact minimal output", async () => {
  const f = fixture();
  const { prescription } = await f.service.issue(issue(), actor);
  const output = await f.service.verify(subject, prescription.prescriptionCode);
  assert.equal(output.valid, true);
  assert.deepEqual(Object.keys(output).sort(), [
    "dispensed",
    "expiresAt",
    "issuedAt",
    "items",
    "valid",
  ]);
  const denied = await f.service.verify(
      randomUUID(),
      prescription.prescriptionCode,
    ),
    missing = await f.service.verify(subject, "unknown");
  assert.deepEqual(denied, missing);
  assert.deepEqual(denied.items, []);
  f.advance();
  const expired = await f.service.verify(
    subject,
    prescription.prescriptionCode,
  );
  assert.equal(expired.valid, false);
  assert.deepEqual(expired.items, []);
});
test("capacity blocks fresh issue/verification rather than returning a misleading absence", async () => {
  const f = fixture(),
    body = issue();
  await f.service.issue(body, actor);
  while (f.rows.length < 100) f.rows.push({ ...f.rows[0], id: randomUUID() });
  await assert.rejects(f.service.issue(issue(), actor), {
    code: "prescription_capacity_reached",
  });
  await assert.rejects(f.service.verify(subject, "unknown"), {
    code: "verification_capacity_reached",
  });
  assert.equal((await f.service.issue(body, actor)).created, false);
});

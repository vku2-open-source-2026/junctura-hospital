// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createExaminations,
  validateNote,
  NOTES,
} from "../server/examinations.mjs";
import { ExaminationError } from "../server/previsit.mjs";
const admissionId = "11111111-1111-4111-8111-111111111111",
  patientSubject = "22222222-2222-4222-8222-222222222222";
const actor = { subject: "doctor", displayName: "Bác sĩ thử nghiệm" };
const input = () => ({
  admissionId,
  requestId: randomUUID(),
  reason: "Lý do giả lập",
  findings: "Ghi nhận giả lập",
  diagnosis: { code: "", name: "Nhận định giả lập" },
  plan: "Kế hoạch giả lập",
});
function fixture() {
  const rows = [];
  const behavior = { status: "called", create: "ok", consent: true };
  const calls = [];
  const sdk = {
    request: async (path) => {
      assert.equal(path, `/v2/data/${NOTES}?limit=100`);
      return { json: async () => ({ items: structuredClone(rows) }) };
    },
    createRecord: async (collection, data) => {
      calls.push([collection, data]);
      if (behavior.create === "before") {
        behavior.create = "ok";
        throw Error("lost");
      }
      const row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        data,
      };
      rows.push(row);
      if (behavior.create === "after") {
        behavior.create = "ok";
        throw Error("lost");
      }
      return structuredClone(row);
    },
  };
  const build = () =>
    createExaminations({
      junctura: sdk,
      admissions: {
        get: async (id) => {
          if (id !== admissionId) throw Error("not owned");
          return {
            id,
            patientSubject,
            status: behavior.status,
            fromFacility: "Trạm thử nghiệm",
          };
        },
      },
      lookupSummary: async (subject) => {
        calls.push(["summary", subject]);
        if (!behavior.consent)
          throw new ExaminationError(403, "treatment_consent_required");
        return { patientSubject: subject, summary: {} };
      },
    });
  return { service: build(), build, rows, behavior, calls };
}
test("examination requires an owned called admission and derives the subject on the server", async () => {
  const f = fixture();
  for (const status of ["waiting", "cancelled", "unavailable"]) {
    f.behavior.status = status;
    await assert.rejects(f.service.open({ admissionId }), {
      code: "patient_not_called",
    });
    await assert.rejects(f.service.save(input(), actor), {
      code: "patient_not_called",
    });
  }
  f.behavior.status = "called";
  await assert.rejects(f.service.summary({ admissionId, patientSubject }), {
    code: "invalid_examination",
  });
  assert.equal(
    (await f.service.summary({ admissionId })).patientSubject,
    patientSubject,
  );
  assert.deepEqual(f.calls, [["summary", patientSubject]]);
});
test("read failure does not cache or substitute external data and local notes remain separate", async () => {
  const f = fixture();
  f.behavior.consent = false;
  await assert.rejects(f.service.summary({ admissionId }), {
    code: "treatment_consent_required",
  });
  const result = await f.service.save(input(), actor);
  assert.equal(result.created, true);
  assert.equal(f.calls[0][0], "summary");
  assert.equal(f.calls[1][0], NOTES);
  assert.deepEqual(f.rows[0].data.createdBy, actor);
  assert.equal("summary" in f.rows[0].data, false);
  assert.equal((await f.service.open({ admissionId })).notes.length, 1);
});
test("same request is replayed after double click and restart, but changed content/actor conflicts", async () => {
  const f = fixture(),
    body = input();
  const results = await Promise.all([
    f.service.save(body, actor),
    f.service.save(body, actor),
  ]);
  assert.equal(results[0].note.id, results[1].note.id);
  assert.equal(f.rows.length, 1);
  assert.equal((await f.build().save(body, actor)).created, false);
  for (const changed of [
    { ...body, plan: "Khác" },
    { ...body, admissionId: randomUUID() },
  ])
    await assert.rejects(f.service.save(changed, actor));
  await assert.rejects(
    f.service.save(body, { ...actor, subject: "other-doctor" }),
    { code: "note_request_conflict" },
  );
});
test("lost create response is reconciled and uncertain outcome is explicit", async () => {
  const f = fixture(),
    body = input();
  f.behavior.create = "after";
  assert.equal((await f.service.save(body, actor)).created, true);
  assert.equal(f.rows.length, 1);
  const g = fixture();
  g.behavior.create = "before";
  await assert.rejects(g.service.save(body, actor), { code: "note_pending" });
  await g.service.save(body, actor);
  assert.equal(g.rows.length, 1);
});
test("history filters other admissions, capacity blocks new writes but permits replay", async () => {
  const f = fixture(),
    body = input();
  await f.service.save(body, actor);
  const old = f.rows[0];
  f.rows.push({
    ...old,
    id: randomUUID(),
    data: { ...old.data, admissionId: randomUUID(), requestId: randomUUID() },
  });
  assert.equal((await f.service.open({ admissionId })).notes.length, 1);
  while (f.rows.length < 100) f.rows.push({ ...old, id: randomUUID() });
  await assert.rejects(f.service.save(input(), actor), {
    code: "note_capacity_reached",
  });
  assert.equal((await f.service.save(body, actor)).created, false);
});
test("rejects unknown fields, controls, missing diagnosis and excessive note data", () => {
  for (const changed of [
    { createdBy: actor },
    { patientSubject },
    { findings: "" },
    { reason: "x".repeat(241) },
    { plan: "\u0000" },
    { diagnosis: { code: "", name: "" } },
    { requestId: "wrong" },
  ])
    assert.throws(() => validateNote({ ...input(), ...changed }), {
      code: "invalid_note",
    });
});

test("a stored note linked to a different patient is never shown under this admission", async () => {
  const f = fixture();
  await f.service.save(input(), actor);
  f.rows[0].data.patientSubject = randomUUID();
  await assert.rejects(f.service.open({ admissionId }), {
    code: "invalid_note_record",
  });
});

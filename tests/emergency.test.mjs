// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createEmergency,
  validateEmergency,
  COLLECTION,
} from "../server/emergency.mjs";
import { ExaminationError } from "../server/previsit.mjs";
const appId = "11111111-1111-4111-8111-111111111111",
  providerAppId = "22222222-2222-4222-8222-222222222222",
  subject = "33333333-3333-4333-8333-333333333333",
  actor = { subject: "doctor", displayName: "Bác sĩ thử nghiệm" };
const input = () => ({
  operationId: randomUUID(),
  patientSubject: subject,
  capability: "pre-visit-summary",
  justification: "Kiểm thử cấp cứu bằng dữ liệu giả lập",
  identityConfirmed: true,
  confirmed: true,
});
function fixture() {
  const rows = [],
    calls = [],
    executions = new Map();
  let time = new Date("2026-11-18T09:00:00.000Z");
  const state = { create: "ok", patch: "ok", backlog: false, review: 403 };
  const json = (v) => ({ json: async () => structuredClone(v) });
  const sdk = {
    request: async (path, options) => {
      if (path === `/v2/data/${COLLECTION}?limit=100`)
        return json({ items: rows });
      if (path === "/v1/emergency-accesses") {
        if (state.review === 403) throw { status: 403 };
        return json({
          reviews: [
            {
              consumer: { appId },
              executionId: [...executions.values()][0]?.id,
              state: "pending",
            },
          ],
        });
      }
      if (options?.method === "PATCH") {
        const row = rows.find((v) => v.id === path.split("/").at(-1));
        row.data = structuredClone(options.json.data);
        calls.push(["patch", row.data]);
        if (state.patch === "after") {
          state.patch = "ok";
          throw Error("lost");
        }
        return json(row);
      }
      throw Error("unexpected request");
    },
    createRecord: async (collection, data) => {
      assert.equal(collection, COLLECTION);
      const row = {
        id: randomUUID(),
        created_at: time.toISOString(),
        data: structuredClone(data),
      };
      rows.push(row);
      calls.push(["create", data]);
      if (state.create === "after") {
        state.create = "ok";
        throw Error("lost");
      }
      return structuredClone(row);
    },
    getRecord: async (_collection, id) =>
      structuredClone(rows.find((v) => v.id === id)),
    execution: async (id) => {
      const e = [...executions.values()].find((v) => v.id === id);
      if (!e) throw Error();
      return {
        executionId: id,
        target: {
          capability: {
            capabilityId: `urn:junctura:capability:${providerAppId}:${e.slug}`,
            version: "1.1.0",
          },
        },
        state: "succeeded",
        output: { privateMedical: "never send in history" },
      };
    },
  };
  const lookup = (slug) => async (patient, signal, emergency) => {
    assert.equal(patient, subject);
    calls.push([
      "lookup",
      slug,
      emergency.operationId,
      emergency.justification,
    ]);
    signal?.throwIfAborted();
    if (state.backlog)
      throw new ExaminationError(429, "emergency_review_backlog");
    if (!executions.has(emergency.operationId))
      executions.set(emergency.operationId, { id: randomUUID(), slug });
    const e = executions.get(emergency.operationId);
    await emergency.onReserved(e.id);
    return {
      patientSubject: patient,
      executionId: e.id,
      receivedAt: time.toISOString(),
      summary: { patientName: "Dữ liệu y tế giả lập" },
    };
  };
  const build = () =>
    createEmergency({
      junctura: sdk,
      appId,
      providerAppId,
      lookups: {
        "pre-visit-summary": lookup("pre-visit-summary"),
        "allergy-list": lookup("allergy-list"),
      },
      now: () => time,
    });
  return {
    service: build(),
    build,
    rows,
    calls,
    state,
    executions,
    expire: () => {
      time = new Date(time.getTime() + 301000);
    },
  };
}
test("requires identity/confirmation, exact subject, reason and only emergency-enabled capabilities", () => {
  for (const patch of [
    { identityConfirmed: false },
    { confirmed: false },
    { patientSubject: "wrong" },
    { justification: "short" },
    { justification: "x".repeat(501) },
    { justification: "Line\nbreak reason" },
    { capability: "referral-summary" },
    { capability: "prescription-verify" },
    { purpose: "emergency_care" },
    { createdBy: actor },
  ])
    assert.throws(() => validateEmergency({ ...input(), ...patch }), {
      code: "invalid_emergency_access",
    });
});
test("registers only operation metadata in Core before lookup and binds the verified doctor", async () => {
  const f = fixture(),
    body = input();
  const result = await f.service.access(body, actor);
  assert.equal(result.patientSubject, subject);
  assert.equal(f.calls[0][0], "create");
  assert.equal(f.rows[0].data.executionId, result.executionId);
  assert.deepEqual(f.rows[0].data.createdBy, actor);
  assert.equal("summary" in f.rows[0].data, false);
  assert.equal(result.justification, body.justification);
});
test("duplicate clicks and process restarts reuse one Core execution and request row", async () => {
  const f = fixture(),
    body = input();
  const [a, b] = await Promise.all([
    f.service.access(body, actor),
    f.service.access(body, actor),
  ]);
  assert.equal(a.executionId, b.executionId);
  assert.equal(
    (await f.build().access(body, actor)).executionId,
    a.executionId,
  );
  assert.equal(f.executions.size, 1);
  assert.equal(f.rows.length, 1);
});
test("reason/subject/doctor cannot be changed by replaying an existing request ID", async () => {
  const f = fixture(),
    body = input();
  await f.service.access(body, actor);
  await assert.rejects(
    f.service.access(
      { ...body, justification: "Nội dung khác để kiểm thử" },
      actor,
    ),
    { code: "emergency_request_conflict" },
  );
  await assert.rejects(f.service.access(body, { ...actor, subject: "other" }), {
    code: "emergency_owner_required",
  });
});
test("ends and expires the Hospital view without deleting or cancelling the Core record", async () => {
  const f = fixture(),
    body = input();
  await f.service.access(body, actor);
  await f.service.end({ operationId: body.operationId }, actor);
  assert.equal(f.executions.size, 1);
  await assert.rejects(f.service.access(body, actor), {
    code: "emergency_request_closed",
  });
  const g = fixture(),
    other = input();
  await g.service.access(other, actor);
  g.expire();
  await assert.rejects(g.service.access(other, actor), {
    code: "emergency_request_closed",
  });
});
test("lost metadata write responses reconcile; backlog stays a Core refusal", async () => {
  const f = fixture();
  f.state.create = "after";
  f.state.patch = "after";
  await f.service.access(input(), actor);
  assert.equal(f.rows.length, 1);
  assert.ok(f.rows[0].data.executionId);
  const g = fixture();
  g.state.backlog = true;
  await assert.rejects(g.service.access(input(), actor), {
    code: "emergency_review_backlog",
  });
  assert.equal(g.executions.size, 0);
  assert.equal(g.rows[0].data.executionId, null);
});
test("history projects Core state without returning medical output or inventing review decisions", async () => {
  const f = fixture();
  await f.service.access(input(), actor);
  let history = await f.service.history();
  assert.equal(history.items[0].state, "succeeded");
  assert.equal(history.items[0].reviewState, null);
  assert.equal(history.reviewVisibility, "administrator");
  assert.equal(JSON.stringify(history).includes("privateMedical"), false);
  f.state.review = 200;
  history = await f.service.history();
  assert.equal(history.items[0].reviewState, "pending");
});

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAdmissions, admissionKey, validateAdmission, COLLECTION, WORKFLOW_KEY } from "../server/admissions.mjs";
import { ReferralError } from "../server/referrals.mjs";
const appId = "11111111-1111-4111-8111-111111111111";
const subject = "22222222-2222-4222-8222-222222222222";
const body = { patientSubject: subject, referralId: "CT-TEST", patientName: "Người bệnh giả lập", birthYear: 1990, sex: "unknown", identityConfirmed: true };
const actor = { subject: "doctor", displayName: "Bác sĩ thử nghiệm" };
function fixture() {
  const rows = new Map(), flows = new Map(), keys = new Map(), calls = [];
  const behavior = { create: "ok", definitions: true, workflowRead: true, lookup: true, target: "Bệnh viện thử nghiệm" };
  const json = value => ({ json: async () => structuredClone(value) });
  const sdk = {
    request: async (path, options = {}) => {
      calls.push(["request", path, options]);
      if (path.startsWith(`/v2/data/${COLLECTION}?`)) return json({ items: [...rows.values()] });
      const id = path.split("/").at(path.endsWith("/complete") ? -2 : -1);
      if (!behavior.workflowRead) throw Error("engine unavailable");
      const flow = flows.get(id); if (!flow) throw Error("unknown workflow");
      if (options.method === "POST") { flow.status = "completed"; calls.push(["complete", id]); }
      return json(flow);
    },
    getRecord: async (collection, id) => { calls.push(["get", collection, id]); if (!rows.has(id)) throw {status:404}; return structuredClone(rows.get(id)); },
    createRecord: async (collection, data) => {
      calls.push(["create", collection]);
      if (behavior.create === "lost-before") { behavior.create = "ok"; throw Error("unknown create outcome"); }
      const row = { id: randomUUID(), data: structuredClone(data), created_at: "2026-11-17T08:00:00.000Z" }; rows.set(row.id, row);
      if (behavior.create === "lost-after") { behavior.create = "ok"; throw Error("response lost"); }
      return structuredClone(row);
    },
    workflowDefinitions: async () => ({ items: behavior.definitions ? [{ id: "definition-1", key: WORKFLOW_KEY }] : [] }),
    startWorkflow: async (definitionId, input, key) => {
      calls.push(["start", definitionId, input, key]);
      if (!keys.has(key)) { const id = randomUUID(); keys.set(key,id); flows.set(id,{id,definitionId,input,status:"running"}); }
      return structuredClone(flows.get(keys.get(key)));
    },
  };
  const lookupReferral = async input => {
    calls.push(["lookup", input]); if (!behavior.lookup) throw new ReferralError(403,"subject_consent_required");
    return { referral: { urgency: "urgent", fromFacility: "Trạm giả lập", toFacility: behavior.target, diagnosis: "never stored" } };
  };
  const build = () => createAdmissions({ junctura:sdk, appId, facility:"Bệnh viện thử nghiệm", lookupReferral });
  return { admissions:build(), build, rows, flows, calls, behavior };
}
test("validates physical identity acknowledgement and never accepts caller-supplied workflow/priority", () => {
  for (const changed of [{identityConfirmed:false},{patientName:""},{birthYear:1899},{birthYear:9999},{sex:"other"},{workflowId:"injected"},{urgency:"emergency"}]) assert.throws(() => validateAdmission({...body,...changed}), {code:"invalid_admission"});
  assert.equal(admissionKey(appId,subject,"CT-TEST"),admissionKey(appId,subject,"CT-TEST"));
  assert.notEqual(admissionKey(appId,subject,"CT-OTHER"),admissionKey(appId,subject,"CT-TEST"));
});
test("fresh consent gates admission, data uses Core private collection and workflow gets only opaque key", async () => {
  const f=fixture(); f.behavior.lookup=false;
  await assert.rejects(f.admissions.admit(body,actor),{code:"subject_consent_required"}); assert.equal(f.flows.size,0); assert.equal(f.rows.size,0);
  f.behavior.lookup=true; const result=await f.admissions.admit(body,actor);
  assert.equal(result.created,true); assert.equal(result.admission.status,"waiting");
  const start=f.calls.find(call=>call[0]==="start"); assert.deepEqual(start[2],{admissionKey:start[3]});
  assert.equal(f.calls.find(call=>call[0]==="create")[1],COLLECTION);
  const data=[...f.rows.values()][0].data; assert.ok(!("diagnosis" in data)); assert.deepEqual(data.createdBy,actor);
});
test("double clicks and restart replays keep one record and one Core workflow", async () => {
  const f=fixture(); const values=await Promise.all([f.admissions.admit(body,actor),f.admissions.admit(body,actor)]);
  assert.equal(values[0].admission.id,values[1].admission.id); assert.equal(values[1].created,false);
  assert.equal(f.rows.size,1); assert.equal(f.flows.size,1);
  const restarted=await f.build().admit(body,actor); assert.equal(restarted.admission.id,values[0].admission.id);
});
test("reconciles a lost create response and recovers workflow-before-record failure with the same key", async () => {
  const after=fixture(); after.behavior.create="lost-after";
  assert.equal((await after.admissions.admit(body,actor)).admission.status,"waiting"); assert.equal(after.rows.size,1);
  const before=fixture(); before.behavior.create="lost-before";
  await assert.rejects(before.admissions.admit(body,actor),{code:"admission_pending"}); assert.equal(before.rows.size,0); assert.equal(before.flows.size,1);
  await before.build().admit(body,actor); assert.equal(before.flows.size,1); assert.equal(before.rows.size,1);
});
test("wrong destination, missing workflow and capacity fail before claiming admission", async () => {
  const target=fixture();target.behavior.target="Bệnh viện khác";await assert.rejects(target.admissions.admit(body,actor),{code:"wrong_destination"});assert.equal(target.rows.size,0);
  const missing=fixture();missing.behavior.definitions=false;await assert.rejects(missing.admissions.admit(body,actor),{code:"admission_workflow_missing"});assert.equal(missing.flows.size,0);
  const full=fixture();await full.admissions.admit(body,actor);const first=[...full.rows.values()][0];for(let i=0;i<99;i++){const id=randomUUID();full.rows.set(id,{...first,id});}
  await assert.rejects(full.admissions.admit({...body,referralId:"CT-NEW"},actor),{code:"admission_capacity_reached"});
  assert.equal((await full.admissions.list()).atCapacity,true);
});
test("call action is authorized by own Core record and workflow is authoritative/idempotent", async () => {
  const f=fixture();const {admission}=await f.admissions.admit(body,actor);
  await assert.rejects(f.admissions.call(randomUUID()),{code:"admission_not_found"});
  assert.equal((await f.admissions.call(admission.id)).admission.status,"called");
  assert.equal((await f.admissions.call(admission.id)).admission.status,"called");
  assert.equal(f.calls.filter(call=>call[0]==="complete").length,1);
  assert.equal((await f.build().list()).items[0].status,"called");
});
test("engine outage never becomes waiting; cancelled workflows cannot be called", async () => {
  const f=fixture();const {admission}=await f.admissions.admit(body,actor);f.behavior.workflowRead=false;
  assert.equal((await f.admissions.list()).items[0].status,"unavailable");await assert.rejects(f.admissions.call(admission.id),{code:"admissions_unavailable"});
  f.behavior.workflowRead=true;[...f.flows.values()][0].status="cancelled";await assert.rejects(f.admissions.call(admission.id),{code:"admission_cancelled"});
});
test("refuses mismatched workflow linkage instead of completing an unrelated process", async () => {
  const f=fixture();const {admission}=await f.admissions.admit(body,actor);[...f.flows.values()][0].input={admissionKey:randomUUID()};
  await assert.rejects(f.admissions.call(admission.id),{code:"invalid_admission_workflow"});assert.equal(f.calls.some(call=>call[0]==="complete"),false);
});

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { createVerifier } from "../server/jwt.mjs";
import { buildStaff } from "../server/staff.mjs";
import { CLIENT, ISSUER, makeSigner } from "./helpers.mjs";

const accounts = { users: [
  { subject: "doctor-subject", username: "bacsi.benhvien", displayName: "Bác sĩ thử nghiệm", role: "physician", app: "junctura-hospital" },
  { subject: "clinic-subject", username: "ysi.tramyte", displayName: "Y sĩ", role: "clinic-staff", app: "junctura-clinic" },
  { subject: "insurance-subject", username: "giamdinh.baohiem", displayName: "Giám định viên", role: "claims-assessor", app: "junctura-insurance" },
  { subject: "unknown-subject", username: "unknown", role: "unknown", app: "junctura-hospital" },
] };
async function fixture(t, options = {}) {
  const signer = makeSigner();
  const dir = mkdtempSync(join(tmpdir(), "hospital-test-"));
  writeFileSync(join(dir, "index.html"), "<html lang='vi'>Hospital shell</html>");
  const config = { issuer: ISSUER, webClientId: CLIENT, facility: "Bệnh viện thử nghiệm", staticDir: dir, clientSecret: "never-public" };
  const verifier = options.verifier ?? createVerifier({ issuer: ISSUER, clientId: CLIENT, getJson: async () => ({ keys: [signer.jwk] }) });
  const server = createServer(createApp({ config, staff: buildStaff(accounts), verifier }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { signer, request: (path, claims, init = {}) => fetch(base + path, {
    ...init, headers: { ...(claims === null ? {} : { Authorization: `Bearer ${signer.sign(claims)}` }), ...init.headers },
  }) };
}
test("public configuration contains only browser-safe fields", async t => {
  const { request } = await fixture(t);
  const response = await request("/api/config", null);
  assert.deepEqual(await response.json(), { issuer: ISSUER, clientId: CLIENT, facility: "Bệnh viện thử nghiệm", product: "Hospital" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal((await request("/health", null)).status, 200);
});
test("requires verified Hospital identity, not browser-supplied roles", async t => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/me", null)).status, 401);
  for (const claims of [
    { exp: 1 }, { iss: "https://evil.test" }, { azp: "health-clinic-web" },
  ]) assert.equal((await request("/api/me", claims)).status, 401);
  for (const claims of [
    { sub: "clinic-subject", preferred_username: "ysi.tramyte", role: "physician" },
    { sub: "insurance-subject", preferred_username: "giamdinh.baohiem" },
    { sub: "unknown-subject", preferred_username: "unknown" },
    { sub: "someone-else", preferred_username: "bacsi.benhvien" },
    { sub: "doctor-subject", preferred_username: "ysi.tramyte" },
  ]) assert.equal((await request("/api/me", claims)).status, 403);
  const response = await request("/api/me", {});
  assert.equal(response.status, 200);
  const me = await response.json();
  assert.equal(me.role, "physician");
  assert.deepEqual(me.permissions, ["workspace.read"]);
});
test("identity infrastructure errors fail closed without internal details", async t => {
  const { request } = await fixture(t, { verifier: async () => { throw new Error("private-host secret"); } });
  const response = await request("/api/me", {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "identity_unavailable" });
});
test("serves the SPA without exposing source, unknown assets or invented APIs", async t => {
  const { request } = await fixture(t);
  assert.match(await (await request("/", null)).text(), /Hospital shell/);
  assert.equal((await request("/login", null)).status, 200);
  assert.equal((await request("/missing.js", null)).status, 404);
  assert.equal((await request("/%2e%2e%5c.env", null)).status, 404);
  assert.equal((await request("/api/patients", {})).status, 404);
  assert.equal((await request("/api/me", {}, { method: "POST" })).status, 405);
});
test("maps seeded staff subjects to actual Keycloak subjects", () => {
  const staff = buildStaff(accounts, { "doctor-subject": "actual-subject" });
  assert.equal(staff.has("doctor-subject"), false);
  assert.equal(staff.get("actual-subject").username, "bacsi.benhvien");
  assert.equal(staff.size, 1);
});

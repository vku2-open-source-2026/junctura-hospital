// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../server/config.mjs";
import { loadStaff } from "../server/staff.mjs";

test("loads the Hospital Health env and honors explicit environment values", t => {
  const dir = mkdtempSync(join(tmpdir(), "hospital-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".junctura/demo"), { recursive: true });
  writeFileSync(join(dir, ".junctura/demo/junctura-hospital.env"), 'JUNCTURA_ISSUER="http://127.0.0.1:8080/identity/realms/junctura"\nJUNCTURA_WEB_CLIENT_ID=health-hospital-web\nWEB_PORT=5182\n');
  const config = loadConfig({ env: { JUNCTURA_HEALTH_DIR: dir, PORT: "5192" }, cwd: dir });
  assert.equal(config.port, 5192);
  assert.equal(config.webClientId, "health-hospital-web");
  assert.ok(!("clientSecret" in config));
});
test("rejects missing identity settings, insecure remote issuer and invalid port", () => {
  assert.throws(() => loadConfig({ env: {}, cwd: tmpdir() }), /demo:setup/);
  const env = { JUNCTURA_ISSUER: "http://evil.test/realm", JUNCTURA_WEB_CLIENT_ID: "health-hospital-web" };
  assert.throws(() => loadConfig({ env }), /HTTPS/);
  assert.throws(() => loadConfig({ env: { ...env, JUNCTURA_ISSUER: "https://id.example.test", PORT: "NaN" } }), /PORT/);
});
test("loads only physicians from the real shared synthetic account directory", () => {
  const config = loadConfig({ env: {
    JUNCTURA_HEALTH_DIR: process.env.JUNCTURA_HEALTH_DIR ?? "../junctura-health",
    JUNCTURA_ISSUER: "https://id.example.test", JUNCTURA_WEB_CLIENT_ID: "health-hospital-web",
  } });
  const staff = loadStaff(config);
  assert.ok(staff.size > 0);
  assert.ok([...staff.values()].every(user => user.role === "physician"));
  assert.ok([...staff.values()].some(user => user.username === "bacsi.benhvien"));
});

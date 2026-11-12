// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";

// Trusted local demo account directory, never roles or identity sent by the browser.
export function buildStaff(accounts, subjects = {}) {
  return new Map(accounts.users.filter(user => user.app === "junctura-hospital" && user.role === "physician")
    .map(user => [subjects[user.subject] ?? user.subject, Object.freeze({
      subject: subjects[user.subject] ?? user.subject, username: user.username,
      displayName: user.displayName, role: user.role,
    })]));
}
export function loadStaff(config) {
  const accounts = JSON.parse(readFileSync(config.accountsFile, "utf8"));
  const subjects = existsSync(config.subjectsFile) ? JSON.parse(readFileSync(config.subjectsFile, "utf8")) : {};
  return buildStaff(accounts, subjects);
}
export function staffIdentity(staff, claims) {
  const user = staff.get(claims.sub);
  return user && user.username === claims.preferred_username && user.role === "physician" ? user : null;
}

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export function demoCases(healthDir, subjects = {}) {
  const clinic = JSON.parse(readFileSync(resolve(healthDir, "seed/data/clinic.json"), "utf8"));
  const accounts = JSON.parse(readFileSync(resolve(healthDir, "seed/data/accounts.json"), "utf8")).users;
  const an = accounts.find(user => user.username === "benhnhan.an");
  const allowed = clinic.referrals.find(item => item.subject === an?.subject);
  const denied = clinic.referrals.find(item => item.subject !== an?.subject && accounts.some(user => user.subject === item.subject && user.role === "patient"));
  if (!allowed || !denied) throw new Error("Health synthetic referral fixtures are missing");
  return [allowed, denied].map((referral, index) => {
    const account = accounts.find(user => user.subject === referral.subject);
    const patient = clinic.patients.find(item => item.subject === referral.subject);
    return { username: account.username, patientSubject: subjects[account.subject] ?? account.subject, referralId: referral.referralId,
      patientName: patient.patientName, birthYear: patient.birthYear, sex: patient.sex,
      label: index === 0 ? "An — thử xem phiếu" : `${patient.patientName} — thử thiếu đồng thuận`, expected: index === 0 ? "allowed" : "denied" };
  });
}

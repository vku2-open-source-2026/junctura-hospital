// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createSign, generateKeyPairSync } from "node:crypto";
export const ISSUER = "https://id.example.test/identity/realms/junctura";
export const CLIENT = "health-hospital-web";
export function makeSigner(kid = "k1") {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const sign = (claims = {}, { header = {}, key = privateKey } = {}) => {
    const body = { iss: ISSUER, azp: CLIENT, exp: Math.floor(Date.now() / 1000) + 300,
      sub: "doctor-subject", preferred_username: "bacsi.benhvien", ...claims };
    const input = `${encode({ alg: "RS256", typ: "JWT", kid, ...header })}.${encode(body)}`;
    return `${input}.${createSign("RSA-SHA256").update(input).sign(key).toString("base64url")}`;
  };
  return { jwk, sign, privateKey };
}

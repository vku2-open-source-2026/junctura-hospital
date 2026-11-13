// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

import {parseEnv} from "../server/env.mjs";
import {loadConfig} from "../server/config.mjs";
import {createReferralLookup} from "../server/referrals.mjs";
import {createJuncturaClient} from "@junctura/server-client";
// Explicit local/demo check. Uses the existing Core PKCE helper, never production data.
const hospital=fileURLToPath(new URL("../",import.meta.url));
const coreDir=resolve(hospital,process.env.JUNCTURA_DXOS_DIR ?? "../junctura-dxos");
if (!process.env.KEYCLOAK_ADMIN_PASSWORD) process.loadEnvFile(resolve(coreDir,".env"));
const {connectDemoStack}=await import(pathToFileURL(resolve(coreDir,"scripts/lib/demo-stack.mjs")).href);
const config=loadConfig({cwd:hospital});
const healthDir=resolve(hospital,process.env.JUNCTURA_HEALTH_DIR ?? "../junctura-health");
const env=parseEnv(readFileSync(resolve(healthDir,".junctura/demo/junctura-hospital.env"),"utf8"));
const demo=parseEnv(readFileSync(resolve(healthDir,".junctura/demo/accounts.env"),"utf8"));
const stack=await connectDemoStack({tenant:"tenant-a"});
const token=await stack.login("benhnhan.an",demo.DEMO_PASSWORD);
const client=createJuncturaClient({...config.junctura,timeoutMs:5000});
const lookup=createReferralLookup({junctura:client,providerAppId:config.referralProviderAppId});
const input={patientSubject:"525fd3dc-fa8c-4472-9c8d-2359aa031f40",referralId:"CT-2026-000123"};
await assert.rejects(lookup(input),{code:"subject_consent_required"});
console.log("PASS: real Core denies missing patient consent");
let consent;
try {
 const response=await stack.api("/v1/me/consents",token,{consumerAppId:env.JUNCTURA_APP_ID,capabilityId:`urn:junctura:capability:${config.referralProviderAppId}:referral-summary`,purposes:["referral_intake"],expiresAt:new Date(Date.now()+86400000).toISOString()});
 assert.equal(response.status,201);consent=(await response.json()).consentId;
 const value=await lookup(input);
 assert.equal(value.referral.referralId,input.referralId);
 assert.equal(value.referral.fromFacility,"Trạm Y tế phường Hòa Khánh Bắc");
 console.log("PASS: Hospital SDK -> Core -> real TLS Clinic provider -> validated referral");
 await assert.rejects(lookup({...input,referralId:"CT-DOES-NOT-EXIST"}),{code:"referral_provider_failed"});
 console.log("PASS: provider failure is not rendered as an empty referral");
} finally {
 if(consent){const response=await stack.api(`/v1/me/consents/${consent}/revoke`,token,{});assert.equal(response.status,200);}
}
await assert.rejects(lookup(input),{code:"subject_consent_required"});
console.log("PASS: real Core denies revoked consent; test consent cleaned up");

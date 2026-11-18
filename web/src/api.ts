// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { freshAccessToken, type OidcSettings } from "./auth";
export interface Config { issuer: string; clientId: string; product: string; facility: string; demoEnabled?: boolean }
export interface Me { subject: string; username: string; displayName: string; role: string; permissions: string[] }
export class ApiError extends Error {
  constructor(public status: number, public code = "request_failed") { super("Hospital request failed"); }
}
export async function getConfig(): Promise<Config> {
  const response = await fetch("/api/config", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}
export async function getMe(settings: OidcSettings): Promise<Me> {
  const token = await freshAccessToken(settings);
  if (!token) throw new ApiError(401);
  const response = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

export interface Referral {
  referralId: string; issuedAt: string; fromFacility: string; toFacility: string;
  urgency: "routine" | "urgent" | "emergency"; reason: string;
  provisionalDiagnosis: { code: string; name: string }; treatmentGiven: string;
}
export interface ReferralResult { patientSubject: string; referralId: string; executionId: string; receivedAt: string; referral: Referral }
export async function lookupReferral(settings: OidcSettings, input: { patientSubject: string; referralId: string }, signal: AbortSignal): Promise<ReferralResult> {
  const token = await freshAccessToken(settings);
  if (!token) throw new ApiError(401, "sign_in_required");
  const response = await fetch("/api/referrals/lookup", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
  });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, typeof body.error === "string" ? body.error : "request_failed");
  return body;
}

export interface Admission {
  id: string; patientSubject: string; patientName: string; birthYear: number | null; sex: string;
  referralId: string; urgency: "routine" | "urgent" | "emergency"; admittedAt: string;
  fromFacility?: string; toFacility?: string; status: "waiting" | "called" | "cancelled" | "unavailable";
}
export interface IdentityInput { patientName: string; birthYear: number | null; sex: string; identityConfirmed: boolean }
export interface DemoCase { patientSubject: string; referralId: string; patientName: string; birthYear: number; sex: string; label: string; expected: string }
async function hospitalRequest<T>(settings: OidcSettings, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await freshAccessToken(settings);
  if (!token) throw new ApiError(401, "sign_in_required");
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: {
    Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000) });
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.error ?? "request_failed");
  return value;
}
export const listAdmissions = (settings: OidcSettings, signal?: AbortSignal) => hospitalRequest<{items: Admission[]; atCapacity: boolean; limit: number}>(settings, "/api/admissions", undefined, signal);
export const confirmAdmission = (settings: OidcSettings, input: IdentityInput & {patientSubject: string; referralId: string}, signal?: AbortSignal) => hospitalRequest<{admission: Admission; created: boolean}>(settings, "/api/admissions", input, signal);
export const callAdmission = (settings: OidcSettings, id: string) => hospitalRequest<{admission: Admission}>(settings, `/api/admissions/${encodeURIComponent(id)}/call`, {});
export const getDemoCases = (settings: OidcSettings, signal?: AbortSignal) => hospitalRequest<{items: DemoCase[]}>(settings, "/api/demo/referrals", undefined, signal);

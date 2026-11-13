// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { freshAccessToken, type OidcSettings } from "./auth";
export interface Config { issuer: string; clientId: string; product: string; facility: string }
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

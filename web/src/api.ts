// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { freshAccessToken, type OidcSettings } from "./auth";
export interface Config { issuer: string; clientId: string; product: string; facility: string; demoEnabled?: boolean }
export interface Me { subject: string; username: string; displayName: string; role: string; permissions: string[] }
export class ApiError extends Error {
  constructor(public status: number, public code = "request_failed", public check?: RxCheck) { super("Hospital request failed"); }
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
  if (!response.ok) throw new ApiError(response.status, value.error ?? "request_failed", value.check);
  return value;
}
export const listAdmissions = (settings: OidcSettings, signal?: AbortSignal) => hospitalRequest<{items: Admission[]; atCapacity: boolean; limit: number}>(settings, "/api/admissions", undefined, signal);
export const confirmAdmission = (settings: OidcSettings, input: IdentityInput & {patientSubject: string; referralId: string}, signal?: AbortSignal) => hospitalRequest<{admission: Admission; created: boolean}>(settings, "/api/admissions", input, signal);
export const callAdmission = (settings: OidcSettings, id: string) => hospitalRequest<{admission: Admission}>(settings, `/api/admissions/${encodeURIComponent(id)}/call`, {});
export const getDemoCases = (settings: OidcSettings, signal?: AbortSignal) => hospitalRequest<{items: DemoCase[]}>(settings, "/api/demo/referrals", undefined, signal);

export interface PrevisitSummary {
  patientName: string; birthYear: number; sex: string; allergyState: "recorded" | "none-known" | "not-recorded";
  allergies: {substance:string;severity:"mild"|"moderate"|"severe";reaction:string}[];
  chronicConditions: {code:string;name:string;since:string}[];
  currentMedications: {name:string;dose:string;since:string}[];
  recentEncounters: {date:string;reason:string;diagnosis:{code:string;name:string}}[]; updatedAt:string;
}
export interface SummaryResult { admissionId:string;patientSubject:string;executionId:string;receivedAt:string;source:string;summary:PrevisitSummary }
export interface NoteInput { admissionId:string;requestId:string;reason:string;findings:string;diagnosis:{code:string;name:string};plan:string }
export interface ExamNote extends NoteInput {id:string;createdAt:string;createdBy:{subject:string;displayName:string}}
export interface ExaminationResult {admission:Admission;notes:ExamNote[];atCapacity:boolean}
export const openExamination=(settings:OidcSettings,admissionId:string,signal?:AbortSignal)=>hospitalRequest<ExaminationResult>(settings,"/api/examinations/open",{admissionId},signal);
export const getPrevisit=(settings:OidcSettings,admissionId:string,signal?:AbortSignal)=>hospitalRequest<SummaryResult>(settings,"/api/examinations/summary",{admissionId},signal);
export const saveExamNote=(settings:OidcSettings,input:NoteInput,signal?:AbortSignal)=>hospitalRequest<{note:ExamNote;created:boolean}>(settings,"/api/examinations/notes",input,signal);

export interface RxItem {name:string;strength:string;quantity:number;instructions:string}
export interface Prescription {id:string;requestId:string;admissionId:string;noteId:string;patientSubject:string;patientName:string;birthYear:number|null;sex:string;prescriptionCode:string;issuedAt:string;expiresAt:string;items:RxItem[];createdBy:{subject:string;displayName:string};dispensed:boolean;expired:boolean}
export interface RxDraft {admissionId:string;noteId:string;items:RxItem[];validDays:number}
export interface RxIssue extends RxDraft {requestId:string;reviewConfirmed:boolean;overrideReason:string}
export interface RxCheck {patientSubject:string;source:string;executionId:string;checkedAt:string;allergy:Pick<PrevisitSummary,"allergyState"|"allergies"|"updatedAt">;conflicts:{medicine:string;allergen:string;severity:string}[];stale:boolean;reviewRequired:boolean}
export interface RxWorkspace extends ExaminationResult {prescriptions:Prescription[];catalog:{name:string;strength:string}[]}
export const listPrescriptions=(s:OidcSettings,signal?:AbortSignal)=>hospitalRequest<{items:Prescription[];atCapacity:boolean}>(s,"/api/prescriptions",undefined,signal);
export const openPrescriptions=(s:OidcSettings,admissionId:string,signal?:AbortSignal)=>hospitalRequest<RxWorkspace>(s,"/api/prescriptions/open",{admissionId},signal);
export const checkPrescription=(s:OidcSettings,input:RxDraft,signal?:AbortSignal)=>hospitalRequest<RxCheck>(s,"/api/prescriptions/check",input,signal);
export const issuePrescription=(s:OidcSettings,input:RxIssue,signal?:AbortSignal)=>hospitalRequest<{prescription:Prescription;created:boolean}>(s,"/api/prescriptions/issue",input,signal);

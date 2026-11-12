// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { freshAccessToken, type OidcSettings } from "./auth";
export interface Config { issuer: string; clientId: string; product: string; facility: string }
export interface Me { subject: string; username: string; displayName: string; role: string; permissions: string[] }
export class ApiError extends Error {
  constructor(public status: number) { super("Hospital request failed"); }
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

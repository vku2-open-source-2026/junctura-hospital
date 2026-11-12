// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { clearSession, completeLogin, freshAccessToken, loadSession, saveSession } from "./auth";
const settings = { issuer: "https://id.example.test", clientId: "health-hospital-web" };
afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
it("rejects a mismatched callback state before contacting Junctura", async () => {
  sessionStorage.setItem("hospital.pending", JSON.stringify({ state: "expected", verifier: "private" }));
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  await expect(completeLogin(settings, "?code=code&state=forged")).rejects.toThrow("state");
  expect(request).not.toHaveBeenCalled();
  expect(loadSession()).toBeNull();
});
it("does not return expired tokens without a refresh token", async () => {
  saveSession({ accessToken: "old", expiresAt: 0 });
  expect(await freshAccessToken(settings)).toBeNull();
});
it("removes the local session when Junctura refuses refresh", async () => {
  saveSession({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  expect(await freshAccessToken(settings)).toBeNull();
  expect(loadSession()).toBeNull();
});

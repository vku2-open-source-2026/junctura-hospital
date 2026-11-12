// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, buildLogoutUrl, createPkce } from "./auth";
const settings = { issuer: "https://id.example.test/identity/realms/junctura", clientId: "health-hospital-web" };
describe("Clinic-derived Hospital PKCE", () => {
  it("derives an S256 challenge with independent random verifier and state", async () => {
    const { verifier, challenge, state } = await createPkce();
    expect(challenge).toBe(Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url"));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(state).not.toBe(verifier);
    expect((await createPkce()).verifier).not.toBe(verifier);
  });
  it("uses the Hospital public client and code flow, never a client secret", () => {
    const url = new URL(buildAuthorizeUrl(settings, "http://localhost:5182/", { state: "state", challenge: "challenge" }));
    expect(url.searchParams.get("client_id")).toBe("health-hospital-web");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5182/");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
  it("logs out at Junctura and returns to Hospital", () => {
    const url = new URL(buildLogoutUrl(settings, "http://localhost:5182/", "identity-token"));
    expect(url.searchParams.get("id_token_hint")).toBe("identity-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:5182/");
  });
});

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { ReferralError } from "./referrals.mjs";
import { AuthError } from "./jwt.mjs";
import { staffIdentity } from "./staff.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

// Thin application boundary adapted from Clinic. Identity stays in Junctura.
export function createApp({ config, staff, verifier, lookupReferral }) {
  const headers = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    "x-frame-options": "DENY", "cache-control": "no-store",
    "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' ${new URL(config.issuer).origin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'` };
  return async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://hospital");
      const path = url.pathname;
      if (path === "/health" && req.method === "GET") return send(200, { status: "ok" });
      if (path === "/api/config" && req.method === "GET") return send(200, {
        issuer: config.issuer, clientId: config.webClientId, product: "Hospital", facility: config.facility,
      });
      if (path.startsWith("/api/")) {
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
        if (!token) throw new AuthError("sign in required");
        const claims = await verifier(token[1]);
        const user = staffIdentity(staff, claims);
        if (!user) return send(403, { error: "forbidden" });
        if (path === "/api/referrals/lookup") {
          if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
          if (url.search) return send(400, { error: "invalid_lookup" });
          if (!/^application\/json(;|$)/i.test(req.headers["content-type"] ?? "")) return send(415, { error: "json_required" });
          let bytes = 0; const chunks = [];
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 2048) return send(413, { error: "payload_too_large" });
            chunks.push(chunk);
          }
          let body;
          try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
          catch { return send(400, { error: "invalid_json" }); }
          if (!lookupReferral) throw new ReferralError(503, "referrals_not_configured");
          const cancellation = new AbortController();
          const disconnect = () => cancellation.abort();
          res.once("close", disconnect);
          try {
            const result = await lookupReferral(body, cancellation.signal);
            if (!res.destroyed) return send(200, result);
            return;
          } finally { res.off("close", disconnect); }
        }
        if (path !== "/api/me") return send(404, { error: "not_found" });
        if (req.method !== "GET") return send(405, { error: "method_not_allowed" });
        return send(200, { ...user, permissions: ["workspace.read"] });
      }
      if (!["GET", "HEAD"].includes(req.method)) return send(405, { error: "method_not_allowed" });
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { return send(400, { error: "invalid_path" }); }
      const base = resolve(config.staticDir);
      let file = resolve(base, `.${decoded}`);
      if (decoded.includes("\\") || decoded.includes("\0") || !file.startsWith(base + sep)) {
        if (decoded !== "/") return send(404, { error: "not_found" });
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(decoded)) return send(404, { error: "not_found" });
        file = resolve(base, "index.html");
      }
      if (!existsSync(file) || !statSync(file).isFile()) return send(503, { error: "web_build_required" });
      res.writeHead(200, { ...headers, "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      if (req.method === "HEAD") return res.end();
      createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof ReferralError) return send(error.status, { error: error.code });
      if (error instanceof AuthError) return send(401, { error: "sign_in_required" });
      return send(503, { error: "identity_unavailable" });
    }
  };
}

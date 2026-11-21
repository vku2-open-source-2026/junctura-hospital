// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { CostError } from "./costs.mjs";
import { PrescriptionError } from "./prescriptions.mjs";
import { ExaminationError } from "./previsit.mjs";
import { AdmissionError } from "./admissions.mjs";
import { ReferralError } from "./referrals.mjs";
import { AuthError } from "./jwt.mjs";
import { staffIdentity } from "./staff.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

// Thin application boundary adapted from Clinic. Identity stays in Junctura.
export function createApp({ config, staff, verifier, lookupReferral, admissions, examinations, prescriptions, costs, emergency, emergencyExample, examples }) {
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
        issuer: config.issuer, clientId: config.webClientId, product: "Hospital", facility: config.facility, ...(config.demoEnabled ? { demoEnabled: true } : {}),
      });
      if (path.startsWith("/api/")) {
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
        if (!token) throw new AuthError("sign in required");
        const claims = await verifier(token[1]);
        const user = staffIdentity(staff, claims);
        if (!user) return send(403, { error: "forbidden" });
        if (path === "/api/demo/referrals" && req.method === "GET") {
          if (!config.demoEnabled || !examples) return send(404, { error: "not_found" });
          return send(200, { items: examples });
        }
        if (path === "/api/admissions" && req.method === "GET") {
          if (url.search) return send(400, { error: "invalid_query" });
          if (!admissions) throw new AdmissionError(503, "admissions_not_configured");
          return send(200, await admissions.list());
        }
        if (path === "/api/prescriptions" && req.method === "GET") {
          if (url.search) return send(400, { error: "invalid_query" });
          if (!prescriptions) throw new PrescriptionError(503,"prescriptions_not_configured");
          return send(200,await prescriptions.list());
        }
        if (path === "/api/emergency/demo" && req.method === "GET") {
          if (!config.demoEnabled || !emergencyExample) return send(404,{error:"not_found"});
          return send(200, emergencyExample);
        }
        if (path === "/api/emergency/history" && req.method === "GET") {
          if (url.search) return send(400,{error:"invalid_query"});
          if (!emergency) throw new ExaminationError(503,"emergency_not_configured");
          return send(200,await emergency.history());
        }
        if (path === "/api/costs" && req.method === "GET") {
          if(url.search) return send(400,{error:"invalid_query"});
          if(!costs) throw new CostError(503,"costs_not_configured");
          return send(200,await costs.list());
        }
        const costAction = /^\/api\/costs\/(open|create)$/.exec(path)?.[1];
        const emergencyAction = /^\/api\/emergency\/(access|end)$/.exec(path)?.[1];
        const rxAction = /^\/api\/prescriptions\/(open|check|issue)$/.exec(path)?.[1];
        const examAction = /^\/api\/examinations\/(open|summary|notes)$/.exec(path)?.[1];
        const callMatch = /^\/api\/admissions\/([0-9a-f-]{36})\/call$/.exec(path);
        if (path === "/api/referrals/lookup" || path === "/api/admissions" || callMatch || examAction || rxAction || emergencyAction || costAction) {
          if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
          if (url.search) return send(400, { error: "invalid_lookup" });
          if (!/^application\/json(;|$)/i.test(req.headers["content-type"] ?? "")) return send(415, { error: "json_required" });
          let bytes = 0; const chunks = [];
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > (costAction ? 16384 : rxAction ? 32768 : examAction ? 16384 : 4096)) return send(413, { error: "payload_too_large" });
            chunks.push(chunk);
          }
          let body;
          try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
          catch { return send(400, { error: "invalid_json" }); }
          if (path === "/api/referrals/lookup" && !lookupReferral) throw new ReferralError(503, "referrals_not_configured");
          if (costAction && !costs) throw new CostError(503,"costs_not_configured");
          if (emergencyAction && !emergency) throw new ExaminationError(503,"emergency_not_configured");
          if (rxAction && !prescriptions) throw new PrescriptionError(503,"prescriptions_not_configured");
          if (examAction && !examinations) throw new ExaminationError(503, "examinations_not_configured");
          if (path !== "/api/referrals/lookup" && !admissions && !examAction && !rxAction && !emergencyAction && !costAction) throw new AdmissionError(503, "admissions_not_configured");
          const cancellation = new AbortController();
          const disconnect = () => cancellation.abort();
          res.once("close", disconnect);
          try {
            if (callMatch && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)) return send(400, { error: "empty_object_required" });
            const result = costAction ? await (costAction === "open" ? costs.open(body) : costs.create(body,user)) : emergencyAction ? await (emergencyAction === "access" ? emergency.access(body,user,cancellation.signal) : emergency.end(body,user)) : rxAction ? await (rxAction === "open" ? prescriptions.open(body) : rxAction === "check" ? prescriptions.check(body,cancellation.signal) : prescriptions.issue(body,user,cancellation.signal)) : examAction ? await (examAction === "open" ? examinations.open(body) : examAction === "summary" ? examinations.summary(body, cancellation.signal) : examinations.save(body, user)) : path === "/api/referrals/lookup" ? await lookupReferral(body, cancellation.signal)
              : callMatch ? await admissions.call(callMatch[1]) : await admissions.admit(body, user, cancellation.signal);
            if (!res.destroyed) return send((path === "/api/admissions" || examAction === "notes" || rxAction === "issue" || costAction === "create") && result.created ? 201 : 200, result);
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
      if (error instanceof ReferralError || error instanceof AdmissionError || error instanceof ExaminationError || error instanceof PrescriptionError || error instanceof CostError) return send(error.status, { error: error.code, ...(error.check ? {check: error.check} : {}) });
      if (error instanceof AuthError) return send(401, { error: "sign_in_required" });
      return send(503, { error: "identity_unavailable" });
    }
  };
}

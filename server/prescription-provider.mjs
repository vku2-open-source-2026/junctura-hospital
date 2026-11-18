// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import {
  buildManifest,
  getContract,
  validateValue,
  checkContext,
} from "@junctura/health-contracts";
import { CostError } from "./costs.mjs";
import { PrescriptionError } from "./prescriptions.mjs";
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export function createPrescriptionHandler({
  junctura,
  prescriptions,
  appId,
  pharmacyAppId,
  costs,
  insuranceAppId,
}) {
  const policies = new Map(
    [
      [
        "/capabilities/prescription-verify",
        {
          slug: "prescription-verify",
          consumer: pharmacyAppId,
          project: (subject, input) =>
            prescriptions.verify(subject, input.prescriptionCode),
        },
      ],
      ...(costs
        ? [
            [
              "/capabilities/claim-verify",
              {
                slug: "claim-verify",
                consumer: insuranceAppId,
                project: (subject, input) =>
                  costs.verify(subject, input.claimId, input.amountVnd),
              },
            ],
          ]
        : []),
    ].map(([path, entry]) => {
      const contract = getContract(entry.slug),
        manifest = buildManifest(contract, appId);
      return [
        path,
        {
          ...entry,
          contract,
          manifest,
          digest: `sha256:${createHash("sha256").update(canonical(manifest)).digest("hex")}`,
        },
      ];
    }),
  );
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, "https://provider");
      const policy = policies.get(url.pathname);
      if (!policy || url.search) return send(404, { error: "not_found" });
      const { contract, manifest, digest } = policy;
      if (req.method !== "POST")
        return send(405, { error: "method_not_allowed" });
      if (!/^application\/json(;|$)/i.test(req.headers["content-type"] ?? ""))
        return send(415, { error: "json_required" });
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) return send(413, { error: "payload_too_large" });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        return send(400, { error: "invalid_json" });
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.invocationId !== "string" ||
        validateValue(contract.inputSchema, body.input).length
      )
        return send(400, { error: "invalid_invocation" });
      const ticket = await junctura.redeemTicket({
        authorization: req.headers.authorization,
        invocationId: body.invocationId,
        input: body.input,
      });
      const c = ticket?.context;
      if (
        !ticket?.active ||
        !checkContext(contract, c).allowed ||
        c.providerAppId !== appId ||
        !policy.consumer ||
        c.actorAppId !== policy.consumer ||
        c.capability?.capabilityId !== manifest.capabilityId ||
        c.capability?.version !== manifest.version ||
        c.capability?.manifestDigest !== digest ||
        c.invocationId !== body.invocationId
      )
        return send(403, { error: "invocation_not_allowed" });
      const output = await policy.project(c.dataSubject, body.input);
      if (validateValue(contract.outputSchema, output).length)
        throw Error("invalid output");
      return send(200, { output });
    } catch (e) {
      return send(
        e instanceof PrescriptionError || e instanceof CostError
          ? e.status
          : 503,
        {
          error: "provider_unavailable",
        },
      );
    }
  };
}
export function startPrescriptionProvider(
  config,
  junctura,
  prescriptions,
  costs,
) {
  if (!config.provider) return null;
  const server = createServer(
    {
      cert: readFileSync(config.provider.certFile),
      key: readFileSync(config.provider.keyFile),
    },
    createPrescriptionHandler({
      junctura,
      prescriptions,
      appId: config.appId,
      pharmacyAppId: config.pharmacyAppId,
      costs,
      insuranceAppId: config.insuranceAppId,
    }),
  );
  server.listen(config.provider.port, config.provider.host, () =>
    console.log(
      `Hospital capability provider listening on HTTPS port ${server.address().port}`,
    ),
  );
  return server;
}

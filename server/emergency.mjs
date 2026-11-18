// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { ExaminationError } from "./previsit.mjs";
import { getContract } from "@junctura/health-contracts";
export const COLLECTION = "hospital_emergency_requests_v1";
export const SLUGS = ["pre-visit-summary", "allergy-list"];
const WINDOW = 5 * 60 * 1000,
  uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class EmergencyError extends ExaminationError {}
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === keys.sort().join(",");
export function validateEmergency(body) {
  if (
    !exact(body, [
      "operationId",
      "patientSubject",
      "capability",
      "justification",
      "identityConfirmed",
      "confirmed",
    ]) ||
    !uuid.test(body.operationId ?? "") ||
    !uuid.test(body.patientSubject ?? "") ||
    !SLUGS.includes(body.capability) ||
    !getContract(body.capability).emergencyAccess ||
    body.identityConfirmed !== true ||
    body.confirmed !== true ||
    typeof body.justification !== "string" ||
    !body.justification.isWellFormed() ||
    /[\u0000-\u001f\u007f]/u.test(body.justification)
  )
    throw new EmergencyError(400, "invalid_emergency_access");
  const justification = body.justification.trim();
  if ([...justification].length < 10 || [...justification].length > 500)
    throw new EmergencyError(400, "invalid_emergency_access");
  return {
    operationId: body.operationId,
    patientSubject: body.patientSubject,
    capability: body.capability,
    justification,
  };
}
const same = (a, b) =>
  ["operationId", "patientSubject", "capability", "justification"].every(
    (key) => a[key] === b[key],
  );
export function createEmergency({
  junctura,
  appId,
  providerAppId,
  lookups,
  now = () => new Date(),
}) {
  let tail = Promise.resolve();
  const serial = (fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  const guard = async (fn) => {
    try {
      if (
        !junctura ||
        !uuid.test(appId ?? "") ||
        !uuid.test(providerAppId ?? "")
      )
        throw new EmergencyError(503, "emergency_not_configured");
      return await fn();
    } catch (e) {
      if (e instanceof ExaminationError) throw e;
      throw new EmergencyError(503, "emergency_unavailable");
    }
  };
  function checked(row) {
    const d = row?.data;
    if (
      !uuid.test(row?.id ?? "") ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      d?.kind !== "hospital-emergency-request/v1" ||
      !uuid.test(d.operationId ?? "") ||
      !uuid.test(d.patientSubject ?? "") ||
      !SLUGS.includes(d.capability) ||
      typeof d.justification !== "string" ||
      typeof d.createdBy?.subject !== "string" ||
      typeof d.createdBy?.displayName !== "string" ||
      (d.executionId !== null && !uuid.test(d.executionId)) ||
      (d.endedAt !== null && !Number.isFinite(Date.parse(d.endedAt)))
    )
      throw new EmergencyError(502, "invalid_emergency_record");
    validateEmergency({
      ...Object.fromEntries(
        ["operationId", "patientSubject", "capability", "justification"].map(
          (k) => [k, d[k]],
        ),
      ),
      identityConfirmed: true,
      confirmed: true,
    });
    return row;
  }
  async function records() {
    const result = await (
      await junctura.request(`/v2/data/${COLLECTION}?limit=100`)
    ).json();
    if (!Array.isArray(result.items))
      throw new EmergencyError(502, "invalid_emergency_record");
    const unique = new Map();
    for (const row of result.items.map(checked)) {
      const prior = unique.get(row.data.operationId);
      if (
        prior &&
        (!same(prior.data, row.data) ||
          prior.data.createdBy.subject !== row.data.createdBy.subject ||
          (prior.data.executionId &&
            row.data.executionId &&
            prior.data.executionId !== row.data.executionId))
      )
        throw new EmergencyError(502, "invalid_emergency_record");
      if (!prior || (!prior.data.executionId && row.data.executionId))
        unique.set(row.data.operationId, row);
    }
    return {
      rows: [...unique.values()],
      atCapacity: result.items.length >= 100,
    };
  }
  async function update(row, patch) {
    const data = { ...row.data, ...patch };
    try {
      await (
        await junctura.request(`/v2/data/${COLLECTION}/${row.id}`, {
          method: "PATCH",
          json: { data },
        })
      ).json();
    } catch {
      const fresh = checked(await junctura.getRecord(COLLECTION, row.id));
      if (!Object.keys(patch).every((key) => fresh.data[key] === patch[key]))
        throw new EmergencyError(503, "emergency_index_pending");
    }
    row.data = data;
  }
  const owned = (row, actor) => {
    if (row.data.createdBy.subject !== actor.subject)
      throw new EmergencyError(403, "emergency_owner_required");
  };
  return {
    access: (body, actor, signal) =>
      serial(() =>
        guard(async () => {
          const input = validateEmergency(body);
          const listing = await records();
          let row = listing.rows.find(
            (v) => v.data.operationId === input.operationId,
          );
          if (row) {
            owned(row, actor);
            if (!same(row.data, input))
              throw new EmergencyError(409, "emergency_request_conflict");
            if (
              row.data.endedAt ||
              now().getTime() - Date.parse(row.created_at) > WINDOW
            )
              throw new EmergencyError(409, "emergency_request_closed");
          } else {
            if (listing.atCapacity)
              throw new EmergencyError(409, "emergency_capacity_reached");
            const data = {
              kind: "hospital-emergency-request/v1",
              ...input,
              executionId: null,
              endedAt: null,
              createdBy: {
                subject: actor.subject,
                displayName: actor.displayName,
              },
            };
            try {
              row = checked(await junctura.createRecord(COLLECTION, data));
            } catch {
              row = (await records()).rows.find(
                (v) => v.data.operationId === input.operationId,
              );
              if (!row)
                throw new EmergencyError(503, "emergency_index_pending");
              owned(row, actor);
              if (!same(row.data, input))
                throw new EmergencyError(409, "emergency_request_conflict");
            }
          }
          const lookup = lookups[input.capability];
          if (!lookup)
            throw new EmergencyError(503, "emergency_not_configured");
          const result = await lookup(input.patientSubject, signal, {
            operationId: input.operationId,
            justification: input.justification,
            onReserved: async (executionId) => {
              if (row.data.executionId && row.data.executionId !== executionId)
                throw new EmergencyError(502, "invalid_emergency_execution");
              if (!row.data.executionId) await update(row, { executionId });
            },
          });
          if (
            result.executionId !== row.data.executionId ||
            result.patientSubject !== input.patientSubject
          )
            throw new EmergencyError(502, "invalid_emergency_execution");
          return {
            ...result,
            operationId: input.operationId,
            capability: input.capability,
            justification: input.justification,
            source: "Clinic",
            expiresAt: new Date(
              Date.parse(row.created_at) + WINDOW,
            ).toISOString(),
          };
        }),
      ),
    end: (body, actor) =>
      serial(() =>
        guard(async () => {
          if (
            !exact(body, ["operationId"]) ||
            !uuid.test(body.operationId ?? "")
          )
            throw new EmergencyError(400, "invalid_emergency_access");
          const row = (await records()).rows.find(
            (v) => v.data.operationId === body.operationId,
          );
          if (!row)
            throw new EmergencyError(404, "emergency_request_not_found");
          owned(row, actor);
          if (!row.data.endedAt)
            await update(row, { endedAt: now().toISOString() });
          return { ended: true };
        }),
      ),
    history: () =>
      guard(async () => {
        const result = await records();
        let reviews = [],
          reviewVisibility = "administrator";
        try {
          const value = await (
            await junctura.request("/v1/emergency-accesses")
          ).json();
          if (!Array.isArray(value.reviews)) throw Error();
          reviews = value.reviews.filter((v) => v.consumer?.appId === appId);
          reviewVisibility = "available";
        } catch (e) {
          if (e.status !== 403) reviewVisibility = "unavailable";
        }
        const items = [];
        for (let i = 0; i < result.rows.length; i += 5) {
          items.push(
            ...(await Promise.all(
              result.rows.slice(i, i + 5).map(async (row) => {
                const d = row.data;
                let state = d.executionId ? "unavailable" : "unlinked";
                if (d.executionId) {
                  try {
                    const status = await junctura.execution(d.executionId);
                    const cap = status.target?.capability;
                    if (
                      status.executionId !== d.executionId ||
                      cap?.capabilityId !==
                        `urn:junctura:capability:${providerAppId}:${d.capability}` ||
                      cap?.version !== getContract(d.capability).version
                    )
                      throw Error();
                    state = status.state;
                  } catch {
                    state = "unavailable";
                  }
                }
                const review = reviews.find(
                  (v) => v.executionId === d.executionId,
                );
                return {
                  operationId: d.operationId,
                  executionId: d.executionId,
                  patientSubject: d.patientSubject,
                  capability: d.capability,
                  justification: d.justification,
                  createdBy: d.createdBy,
                  requestedAt: row.created_at,
                  endedAt: d.endedAt,
                  state,
                  reviewState: review?.state ?? null,
                };
              }),
            )),
          );
        }
        items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        return { items, atCapacity: result.atCapacity, reviewVisibility };
      }),
  };
}

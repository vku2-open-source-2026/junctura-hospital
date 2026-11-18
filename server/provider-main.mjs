// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createJuncturaClient } from "@junctura/server-client";
import { loadConfig } from "./config.mjs";
import {
  createPrescriptions,
  loadPrescriptionCatalog,
} from "./prescriptions.mjs";
import { startPrescriptionProvider } from "./prescription-provider.mjs";
try {
  const c = loadConfig();
  if (!c.junctura || !c.provider)
    throw Error("Configure provider TLS and Hospital Core credentials first");
  const sdk = createJuncturaClient({ ...c.junctura, timeoutMs: 1500 });
  const service = createPrescriptions({
    junctura: sdk,
    catalog: await loadPrescriptionCatalog(c.healthDir),
  });
  const server = startPrescriptionProvider(c, sdk, service);
  server.on("error", () => {
    console.error("Hospital provider failed to listen");
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
} catch {
  console.error("Hospital provider configuration unavailable");
  process.exitCode = 1;
}

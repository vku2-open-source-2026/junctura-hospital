// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../server/config.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const c = loadConfig({ cwd: root });
  if (
    !c.junctura ||
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(c.junctura.baseUrl).hostname,
    )
  )
    throw Error("Provider helper requires the local demo Core");
  const core = resolve(
    root,
    process.env.JUNCTURA_DXOS_DIR ?? "../junctura-dxos",
  );
  if (
    !existsSync(
      resolve(core, ".junctura/pki/hospital.provider.internal.crt"),
    ) ||
    !c.pharmacyAppId
  )
    throw Error(
      "Prepare hospital provider PKI in Core and Health demo apps first",
    );
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "compose.provider-demo.yaml",
      ...(process.argv.includes("--down")
        ? ["down"]
        : ["up", "--detach", "--wait", "--wait-timeout", "90"]),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        JUNCTURA_HEALTH_DIR: c.healthDir,
        JUNCTURA_DXOS_DIR: core,
        JUNCTURA_PHARMACY_APP_ID: c.pharmacyAppId,
      },
    },
  );
} catch (e) {
  console.error(
    e.message?.includes("Command failed")
      ? "Demo provider could not start; check Docker, network names and provider PKI."
      : e.message,
  );
  process.exitCode = 1;
}

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createServer } from "node:http";
import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { createVerifier } from "./jwt.mjs";
import { loadStaff } from "./staff.mjs";

try {
  let config = loadConfig();
  const flag = process.argv.indexOf("--port");
  if (flag !== -1) {
    const port = Number(process.argv[flag + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port requires a valid port.");
    config = Object.freeze({ ...config, port });
  }
  const staff = loadStaff(config);
  const verifier = createVerifier({ issuer: config.issuer, keysBase: config.issuerInternal, clientId: config.webClientId });
  const server = createServer(createApp({ config, staff, verifier }));
  server.on("error", error => { console.error(`Hospital could not start (${error.code ?? "server_error"}).`); process.exitCode = 1; });
  server.listen(config.port, config.host, () => console.log(`Junctura Hospital listening on http://${config.host}:${server.address().port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
} catch (error) { console.error(error.message); process.exitCode = 1; }

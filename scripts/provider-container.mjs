// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Loopback transport for the Core SDK in the isolated demo container; no public HTTP port.
import { createServer, connect } from "node:net";
const bridge = createServer((socket) => {
  const upstream = connect(8080, "gateway");
  socket.pipe(upstream).pipe(socket);
  socket.on("error", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
});
bridge.listen(8080, "127.0.0.1", () =>
  import("../server/provider-main.mjs").catch(() => {
    console.error("Hospital provider startup failed");
    process.exit(1);
  }),
);

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createJuncturaClient } from "@junctura/server-client";
import { loadConfig } from "../server/config.mjs";
import { WORKFLOW_KEY } from "../server/admissions.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const config = loadConfig({ cwd: root });
  if (!config.junctura) throw new Error("Prepare the Health demo application first.");
  const url = new URL(config.junctura.baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("This operator helper is for local/demo Core only.");
  const identity = await createJuncturaClient(config.junctura).identity();
  const xml = readFileSync(resolve(root, "workflows/hospital-intake-v1.bpmn20.xml"), "utf8");
  const name = `hospital-intake-v1-${createHash("sha256").update(xml).digest("hex").slice(0,12)}`;
  // Operator configuration only: reuse Core's private initializer client inside its container.
  // Hospital runtime never receives the engine password or calls Flowable directly.
  const program = `import {workflowRequest} from "/app/src/modules/workflow/client.mjs";
const cfg={workflowUrl:process.env.WORKFLOW_URL,workflowPassword:process.env.WORKFLOW_ADMIN_PASSWORD};
const tenant=${JSON.stringify(identity.tenantId)}, key=${JSON.stringify(WORKFLOW_KEY)}, name=${JSON.stringify(name)}, xml=${JSON.stringify(xml)};
const existing=await workflowRequest(cfg,"repository/process-definitions?"+new URLSearchParams({tenantId:tenant,key,latest:"true"}));
if(existing.data.length){
 const response=await fetch(cfg.workflowUrl+"/repository/deployments/"+encodeURIComponent(existing.data[0].deploymentId)+"/resourcedata/hospital-intake-v1.bpmn20.xml",{
  headers:{Authorization:"Basic "+Buffer.from("junctura-engine:"+cfg.workflowPassword).toString("base64")},redirect:"error",signal:AbortSignal.timeout(10000)
 });
 if(!response.ok || await response.text()!==xml)throw Error("Workflow definition drift: publish a new versioned key, do not overwrite live flows");
}else{
 const form=new FormData();form.append("tenantId",tenant);form.append("deploymentName",name);
 form.append("file",new Blob([xml],{type:"application/xml"}),"hospital-intake-v1.bpmn20.xml");
 await workflowRequest(cfg,"repository/deployments",{method:"POST",body:form});
}
console.log("Hospital admission workflow is configured for the verified tenant.");`;
  const result = execFileSync("docker", ["compose", "exec", "-T", "core", "node", "--input-type=module"], {
    cwd: resolve(root, process.env.JUNCTURA_DXOS_DIR ?? "../junctura-dxos"), input: program, encoding: "utf8", timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  process.stdout.write(result);
} catch (error) {
  console.error(error.status >= 400 ? "Could not authenticate with the local Core." : error.message?.includes("Command failed") ? "Workflow setup failed. Check Core/Flowable readiness or definition drift." : error.message);
  process.exitCode = 1;
}

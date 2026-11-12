// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Preserve upstream copyright/license notices with the generated browser assets.
const modules = resolve("web/node_modules");
const destination = resolve("web/dist/notices");
mkdirSync(destination, { recursive: true });
const packages = ["@junctura/health-ui", "react", "react-dom", "scheduler", "lucide-react",
  "@fontsource-variable/inter", "@fontsource-variable/jetbrains-mono", "tailwindcss"];
const inventory = [];
for (const name of packages) {
  const source = join(modules, name);
  const metadata = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  const folder = name.replaceAll("/", "__").replaceAll("@", "");
  const target = join(destination, folder);
  mkdirSync(target, { recursive: true });
  const notices = readdirSync(source).filter(file => /^(license|notice|copying|ofl)(\.|$)/i.test(file));
  if (!notices.length) throw new Error(`No license notice found for ${name}`);
  for (const file of notices) copyFileSync(join(source, file), join(target, file));
  inventory.push({ name, version: metadata.version, license: metadata.license, notices: notices.map(file => `${folder}/${file}`) });
}
for (const file of ["LICENSE", "NOTICE"]) {
  if (existsSync(file)) copyFileSync(file, join(destination, file));
}
writeFileSync(join(destination, "index.json"), JSON.stringify(inventory, null, 2) + "\n");
console.log(`Preserved browser notices for ${inventory.length} packages`);

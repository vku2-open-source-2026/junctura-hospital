<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Third-party dependencies

Dependencies are declared in package.json and lockfiles, installed from npm and never vendored.

| Component | License | Use |
| --- | --- | --- |
| Junctura Clinic scaffolding | Apache-2.0 | Environment parsing, JWT verifier, browser PKCE, checks |
| @junctura/server-client | Apache-2.0 | Core SDK, reserved for subsequent integration |
| @junctura/health-contracts | Apache-2.0 | Shared capability definitions |
| @junctura/health-ui | Apache-2.0 | React components, design tokens and fonts |
| React / React DOM | MIT | UI runtime |
| lucide-react | ISC | Icons |
| Vite, Vitest, Tailwind, Testing Library, jsdom | MIT | Development and build tooling |
| TypeScript | Apache-2.0 | Type checking |
| @fontsource-variable/inter | OFL-1.1 (font) | Transitive Health UI font |
| @fontsource-variable/jetbrains-mono | OFL-1.1 (font) | Transitive Health UI font |

Exact versions and transitive dependencies are recorded in the lockfiles. Font license notices must remain with any redistributed font assets.

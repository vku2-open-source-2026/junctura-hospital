// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { DisplayPrefsProvider } from "@junctura/health-ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "./App";
import { Landing } from "./Landing";
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(cleanup);
it("uses the common landing and clearly labels the bootstrap scope", () => {
  const signIn = vi.fn();
  render(<DisplayPrefsProvider><Landing onSignIn={signIn} /></DisplayPrefsProvider>);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Kết nối thông tin");
  expect(screen.getByText(/Bản này có đăng nhập và khung làm việc/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Đăng nhập" })[0]);
  expect(signIn).toHaveBeenCalledOnce();
});
it("navigates the shared workspace without claiming patient modules are ready", () => {
  render(<DisplayPrefsProvider><Workspace me={{ subject: "doctor", username: "doctor", displayName: "Bác sĩ thử nghiệm", role: "physician", permissions: ["workspace.read"] }} facility="Bệnh viện thử nghiệm" onSignOut={vi.fn()} /></DisplayPrefsProvider>);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hàng đợi");
  fireEvent.click(screen.getByRole("button", { name: "Chi phí" }));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chi phí");
  expect(screen.getByText("Chức năng đang được xây dựng")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Tạo hồ sơ|Kê đơn/ })).toBeNull();
});

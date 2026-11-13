// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, lookupReferral, type ReferralResult } from "./api";
import { Intake } from "./Intake";
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), lookupReferral: vi.fn() }));
const subject = "22222222-2222-4222-8222-222222222222";
const other = "44444444-4444-4444-8444-444444444444";
const result: ReferralResult = { patientSubject: subject, referralId: "CT-TEST", executionId: "execution", receivedAt: "2026-11-01T10:00:00.000Z", referral: {
  referralId: "CT-TEST", issuedAt: "2026-11-01T09:30:00.000Z", fromFacility: "Trạm giả lập", toFacility: "Bệnh viện giả lập", urgency: "urgent",
  reason: "Lý do chuyển giả lập", provisionalDiagnosis: { code: "", name: "Chưa rõ" }, treatmentGiven: "Xử trí giả lập",
} };
const settings = { issuer: "https://id.example.test", clientId: "health-hospital-web" };
const fill = () => {
  fireEvent.change(screen.getByLabelText(/Mã định danh/), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText(/Mã phiếu chuyển tuyến/), { target: { value: "CT-TEST" } });
};
beforeEach(() => { vi.mocked(lookupReferral).mockReset(); });
afterEach(cleanup);
it("shows empty, loading, patient context, source and date without inventing demographics", async () => {
  let finish!: (value: ReferralResult) => void;
  vi.mocked(lookupReferral).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Intake settings={settings} />);
  expect(screen.getByText("Chưa tra cứu phiếu")).toBeTruthy();
  fill(); fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiếu" }));
  expect(screen.getByText("Đang tải")).toBeTruthy();
  expect(screen.getByText("Họ tên: Chưa rõ")).toBeTruthy();
  expect(screen.getByText("Không xem được dị ứng")).toBeTruthy();
  finish(result);
  expect(await screen.findByText("Lý do chuyển giả lập")).toBeTruthy();
  expect(screen.getByText(/Nguồn: Clinic/)).toBeTruthy();
  expect(screen.getByText(/Phát hành/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Xác nhận tiếp nhận|Truy cập cấp cứu/ })).toBeNull();
});
it("clears previous data immediately and ignores late results after changing patient", async () => {
  let finish!: (value: ReferralResult) => void;
  vi.mocked(lookupReferral).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Intake settings={settings} />); fill(); fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiếu" }));
  fireEvent.change(screen.getByLabelText(/Mã định danh/), { target: { value: other } });
  finish(result);
  await waitFor(() => expect(screen.getByText("Chưa tra cứu phiếu")).toBeTruthy());
  expect(screen.queryByText("Lý do chuyển giả lập")).toBeNull();
  expect(screen.queryByText(subject)).toBeNull();
});
it("removes a successful result when the referral code changes", async () => {
  vi.mocked(lookupReferral).mockResolvedValue(result);
  render(<Intake settings={settings} />); fill(); fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiếu" }));
  await screen.findByText("Lý do chuyển giả lập");
  fireEvent.change(screen.getByLabelText(/Mã phiếu chuyển tuyến/), { target: { value: "CT-OTHER" } });
  expect(screen.queryByText("Lý do chuyển giả lập")).toBeNull();
});
it.each([
  ["subject_consent_required", "Chưa có đồng thuận"], ["referral_access_denied", "Chưa có quyền tra cứu phiếu"],
  ["referral_timeout", "Chưa lấy được phiếu chuyển tuyến"], ["referral_provider_failed", "Chưa lấy được phiếu chuyển tuyến"],
  ["sign_in_required", "Phiên đăng nhập đã hết hạn"],
])("explains %s explicitly", async (code, title) => {
  vi.mocked(lookupReferral).mockRejectedValue(new ApiError(403, code));
  render(<Intake settings={settings} />); fill(); fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiếu" }));
  expect(await screen.findByText(title)).toBeTruthy();
  if (code === "subject_consent_required") expect(screen.getByText(/Nhờ người bệnh cấp đồng thuận/)).toBeTruthy();
});
it("validates the subject before requesting Core", () => {
  render(<Intake settings={settings} />); fill();
  fireEvent.change(screen.getByLabelText(/Mã định danh/), { target: { value: "P0001" } });
  fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiếu" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(lookupReferral).not.toHaveBeenCalled();
});

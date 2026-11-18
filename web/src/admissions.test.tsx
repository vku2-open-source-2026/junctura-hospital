// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, callAdmission, confirmAdmission, listAdmissions, type Admission, type ReferralResult } from "./api";
import { AdmissionForm, HospitalQueue } from "./Admissions";
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), callAdmission: vi.fn(), confirmAdmission: vi.fn(), listAdmissions: vi.fn() }));
const settings = { issuer: "https://id.example.test", clientId: "health-hospital-web" };
const item: Admission = { id:"admission", patientSubject:"patient", patientName:"Người bệnh giả lập", birthYear:1980, sex:"male", referralId:"CT-TEST", fromFacility:"Trạm giả lập", toFacility:"Bệnh viện", urgency:"urgent", admittedAt:"2026-11-01T10:00:00Z", status:"waiting" };
const result = { patientSubject:"patient", referralId:"CT-TEST" } as ReferralResult;
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
it("requires physical identity confirmation and reports a lost consent without succeeding", async () => {
  vi.mocked(confirmAdmission).mockRejectedValue(new ApiError(403,"subject_consent_required"));
  render(<AdmissionForm settings={settings} result={result} onShowQueue={() => {}} />);
  const button = screen.getByRole("button",{name:"Xác nhận tiếp nhận"}) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText(/Họ tên đã đối chiếu/),{target:{value:item.patientName}});
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(await screen.findByText("Chưa có đồng thuận")).toBeTruthy();
  expect(screen.queryByText("Đã tiếp nhận")).toBeNull();
  expect(confirmAdmission).toHaveBeenCalledWith(settings,expect.objectContaining({identityConfirmed:true,patientSubject:"patient",referralId:"CT-TEST"}),expect.any(AbortSignal));
});
it("shows an existing admission without claiming another admission was created", async () => {
  vi.mocked(confirmAdmission).mockResolvedValue({admission:item,created:false});
  const show = vi.fn();
  render(<AdmissionForm settings={settings} result={result} onShowQueue={show} />);
  fireEvent.change(screen.getByLabelText(/Họ tên đã đối chiếu/),{target:{value:item.patientName}});
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Xác nhận tiếp nhận"}));
  expect(await screen.findByText("Phiếu này đã được tiếp nhận trước đó")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Xem hàng đợi"}));expect(show).toHaveBeenCalledOnce();
});
it("refreshes authoritative workflow state after calling a waiting person", async () => {
  vi.mocked(listAdmissions).mockResolvedValueOnce({items:[item],atCapacity:false,limit:100}).mockResolvedValue({items:[{...item,status:"called"}],atCapacity:false,limit:100});
  vi.mocked(callAdmission).mockResolvedValue({admission:{...item,status:"called"}});
  render(<HospitalQueue settings={settings} onIntake={() => {}} />);
  fireEvent.click(await screen.findByRole("button",{name:/Gọi vào khám/}));
  await waitFor(() => expect(listAdmissions).toHaveBeenCalledTimes(2));
  await screen.findByText(item.patientName);
  expect(screen.queryByRole("button",{name:/Gọi vào khám/})).toBeNull();
  expect(callAdmission).toHaveBeenCalledWith(settings,item.id);
});
it("does not allow calling when workflow status is unavailable", async () => {
  vi.mocked(listAdmissions).mockResolvedValue({items:[{...item,status:"unavailable"}],atCapacity:false,limit:100});
  render(<HospitalQueue settings={settings} onIntake={() => {}} />);
  expect(await screen.findByText("Cần kiểm tra trạng thái")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/Gọi vào khám/})).toBeNull();
});

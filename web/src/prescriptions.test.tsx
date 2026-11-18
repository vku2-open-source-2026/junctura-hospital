// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ApiError,
  listPrescriptions,
  openPrescriptions,
  checkPrescription,
  issuePrescription,
  type RxWorkspace,
  type RxCheck,
  type Prescription,
} from "./api";
import { Prescriptions } from "./Prescriptions";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  listPrescriptions: vi.fn(),
  openPrescriptions: vi.fn(),
  checkPrescription: vi.fn(),
  issuePrescription: vi.fn(),
}));
const settings = { issuer: "https://id.test", clientId: "hospital" },
  initial = { admissionId: "admission", noteId: "note" };
const value: RxWorkspace = {
  admission: {
    id: "admission",
    patientSubject: "patient",
    patientName: "An giả lập",
    birthYear: 1968,
    sex: "male",
    referralId: "CT-TEST",
    urgency: "urgent",
    status: "called",
    admittedAt: "2026-11-18T08:00:00Z",
  },
  notes: [
    {
      id: "note",
      admissionId: "admission",
      requestId: "request",
      reason: "Test",
      findings: "Test",
      diagnosis: { code: "", name: "Kiểm thử" },
      plan: "Test",
      createdAt: "2026-11-18T08:00:00Z",
      createdBy: { subject: "doctor", displayName: "Bác sĩ" },
    },
  ],
  prescriptions: [],
  atCapacity: false,
  catalog: [
    { name: "Amoxicillin", strength: "500 mg" },
    { name: "Clopidogrel", strength: "75 mg" },
  ],
};
const check: RxCheck = {
  patientSubject: "patient",
  source: "Trạm giả lập",
  executionId: "execution",
  checkedAt: "2026-11-18T08:00:00Z",
  allergy: {
    allergyState: "recorded",
    allergies: [
      { substance: "Penicillin", severity: "severe", reaction: "Giả lập" },
    ],
    updatedAt: "2026-11-18T07:00:00Z",
  },
  conflicts: [
    { medicine: "Amoxicillin", allergen: "Penicillin", severity: "severe" },
  ],
  stale: false,
  reviewRequired: true,
};
const prescription: Prescription = {
  id: "rx",
  requestId: "request",
  admissionId: "admission",
  noteId: "note",
  patientSubject: "patient",
  patientName: "An giả lập",
  birthYear: 1968,
  sex: "male",
  prescriptionCode: "DT-TEST",
  issuedAt: "2026-11-18T08:00:00Z",
  expiresAt: "2026-11-25T08:00:00Z",
  items: [{ ...value.catalog[0], quantity: 1, instructions: "Giả lập" }],
  createdBy: { subject: "doctor", displayName: "Bác sĩ" },
  dispensed: false,
  expired: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listPrescriptions).mockResolvedValue({
    items: [],
    atCapacity: false,
  });
  vi.mocked(openPrescriptions).mockResolvedValue(value);
  vi.mocked(checkPrescription).mockResolvedValue(check);
});
afterEach(cleanup);
async function fill() {
  await screen.findByLabelText(/Thuốc dòng 1/);
  fireEvent.change(screen.getByLabelText(/Thuốc dòng 1/), {
    target: { value: "Amoxicillin" },
  });
  fireEvent.change(screen.getByLabelText(/Cách dùng dòng 1/), {
    target: { value: "Nội dung thử giả lập" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Kiểm tra dị ứng và xem lại đơn" }),
  );
}
it("global prescription empty state points back to examination", async () => {
  render(<Prescriptions settings={settings} onExam={() => {}} />);
  expect(await screen.findByText("Chưa có đơn thuốc")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Mở Khám để kê đơn" }),
  ).toBeTruthy();
});
it("missing allergy consent never becomes no known allergy", async () => {
  vi.mocked(checkPrescription).mockRejectedValue(
    new ApiError(403, "treatment_consent_required"),
  );
  render(
    <Prescriptions settings={settings} initial={initial} onExam={() => {}} />,
  );
  await fill();
  expect(await screen.findByText("Chưa có đồng thuận điều trị")).toBeTruthy();
  expect(screen.getByText("Không xem được dị ứng")).toBeTruthy();
  expect(screen.queryByText("Không có dị ứng đã biết")).toBeNull();
  expect(issuePrescription).not.toHaveBeenCalled();
});
it("severe conflict requires reason and a separate confirmation; editing invalidates the check", async () => {
  render(
    <Prescriptions settings={settings} initial={initial} onExam={() => {}} />,
  );
  await fill();
  expect(await screen.findByText("Thuốc trùng cảnh báo dị ứng")).toBeTruthy();
  expect(screen.getByText("Penicillin · Nặng · Giả lập")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  const button = screen.getByRole("button", {
    name: "Phát hành đơn thuốc",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Lý do tiếp tục/), {
    target: { value: "Kiểm thử có lý do trên dữ liệu giả" },
  });
  expect(button.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText(/Số lượng dòng 1/), {
    target: { value: "2" },
  });
  expect(screen.queryByText("Thuốc trùng cảnh báo dị ứng")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Phát hành đơn thuốc" }),
  ).toBeNull();
});
it.each(["none-known", "not-recorded"] as const)(
  "keeps allergy state %s distinct",
  async (state) => {
    vi.mocked(checkPrescription).mockResolvedValue({
      ...check,
      allergy: { ...check.allergy, allergyState: state, allergies: [] },
      conflicts: [],
      reviewRequired: state === "not-recorded",
    });
    render(
      <Prescriptions settings={settings} initial={initial} onExam={() => {}} />,
    );
    await fill();
    expect(
      (
        await screen.findAllByText(
          state === "none-known"
            ? "Không có dị ứng đã biết"
            : "Chưa ghi nhận dị ứng",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/Lý do tiếp tục/) !== null).toBe(
      state === "not-recorded",
    );
  },
);
it("lost issue responses retain the same request and cannot change the draft", async () => {
  vi.mocked(checkPrescription).mockResolvedValue({
    ...check,
    conflicts: [],
    reviewRequired: false,
  });
  vi.mocked(issuePrescription)
    .mockRejectedValueOnce(new ApiError(503, "prescription_pending"))
    .mockResolvedValue({ prescription, created: false });
  render(
    <Prescriptions settings={settings} initial={initial} onExam={() => {}} />,
  );
  await fill();
  await screen.findByRole("button", { name: "Phát hành đơn thuốc" });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Phát hành đơn thuốc" }));
  const retry = await screen.findByRole("button", {
    name: "Thử lại cùng thao tác phát hành",
  });
  expect(
    (screen.getByLabelText(/Cách dùng dòng 1/) as HTMLTextAreaElement).disabled,
  ).toBe(true);
  fireEvent.click(retry);
  expect(
    await screen.findByText(
      "Đã phát hành đơn thuốc trên Junctura. Xem mã đơn bên dưới.",
    ),
  ).toBeTruthy();
  expect(vi.mocked(issuePrescription).mock.calls[0][1]).toEqual(
    vi.mocked(issuePrescription).mock.calls[1][1],
  );
  expect(screen.getByText("DT-TEST")).toBeTruthy();
});

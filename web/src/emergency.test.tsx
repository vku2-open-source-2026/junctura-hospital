// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ApiError,
  requestEmergency,
  endEmergency,
  emergencyHistory,
  getEmergencyDemo,
  type EmergencyInput,
  type EmergencyResult,
} from "./api";
import { Emergency } from "./Emergency";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  requestEmergency: vi.fn(),
  endEmergency: vi.fn(),
  emergencyHistory: vi.fn(),
  getEmergencyDemo: vi.fn(),
}));
const subject = "33333333-3333-4333-8333-333333333333",
  settings = { issuer: "https://id.test", clientId: "hospital" };
const reason = "Kiểm thử tình huống cấp cứu với dữ liệu giả lập";
const response = (input: EmergencyInput): EmergencyResult => ({
  ...input,
  capability: "pre-visit-summary",
  executionId: "execution",
  source: "Clinic",
  receivedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  summary: {
    patientName: "Bình giả lập",
    birthYear: 1980,
    sex: "male",
    allergies: [],
    allergyState: "not-recorded",
    chronicConditions: [],
    currentMedications: [],
    recentEncounters: [],
    updatedAt: "2026-11-18T08:00:00Z",
  },
});
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
  vi.resetAllMocks();
  vi.mocked(emergencyHistory).mockResolvedValue({
    items: [],
    atCapacity: false,
    reviewVisibility: "administrator",
  });
  vi.mocked(endEmergency).mockResolvedValue({ ended: true });
  vi.mocked(requestEmergency).mockImplementation(async (_s, input) =>
    response(input),
  );
  vi.mocked(getEmergencyDemo).mockResolvedValue({
    patientSubject: subject,
    label: "Bình — thử truy cập cấp cứu",
  });
});
afterEach(cleanup);
async function start() {
  fireEvent.change(screen.getByLabelText(/Mã định danh Junctura/), {
    target: { value: subject },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Nhập lý do truy cập cấp cứu" }),
  );
  await screen.findByLabelText(/Lý do truy cập khẩn cấp/);
  fireEvent.change(screen.getByLabelText(/Lý do truy cập khẩn cấp/), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
}
async function confirm() {
  await start();
  fireEvent.click(
    screen.getByRole("button", { name: "Xác nhận truy cập khẩn cấp" }),
  );
}
it("requires physical identity and both dialog steps before making the emergency request", async () => {
  render(<Emergency settings={settings} />);
  expect(
    (
      screen.getByRole("button", {
        name: "Nhập lý do truy cập cấp cứu",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await start();
  expect(requestEmergency).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Xác nhận truy cập khẩn cấp" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Xác nhận truy cập khẩn cấp" }),
  );
  expect(await screen.findByText("Bình giả lập", { exact: true })).toBeTruthy();
  expect(requestEmergency).toHaveBeenCalledWith(
    settings,
    expect.objectContaining({
      patientSubject: subject,
      capability: "pre-visit-summary",
      justification: reason,
      identityConfirmed: true,
      confirmed: true,
    }),
    expect.any(AbortSignal),
  );
  expect(screen.getByText(/Đang truy cập khẩn cấp/)).toBeTruthy();
});
it("cancelling the second confirmation spends no Core request", async () => {
  render(<Emergency settings={settings} />);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
  fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  expect(requestEmergency).not.toHaveBeenCalled();
  expect(screen.queryByText(/Đang truy cập khẩn cấp/)).toBeNull();
});
it("ending clears medical data and a late response cannot restore it", async () => {
  let finish!: (value: EmergencyResult) => void;
  vi.mocked(requestEmergency).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Emergency settings={settings} />);
  await confirm();
  const input = vi.mocked(requestEmergency).mock.calls[0][1];
  fireEvent.click(
    screen.getByRole("button", { name: "Kết thúc truy cập khẩn cấp" }),
  );
  finish(response(input));
  await waitFor(() =>
    expect(endEmergency).toHaveBeenCalledWith(settings, input.operationId),
  );
  expect(screen.queryByText("Bình giả lập", { exact: true })).toBeNull();
  expect(screen.queryByText(/Đang truy cập khẩn cấp/)).toBeNull();
  expect(screen.getByText(/Đã xóa dữ liệu khỏi màn xem/)).toBeTruthy();
});
it("Core backlog is not treated as access granted and retries keep the same operation", async () => {
  vi.mocked(requestEmergency).mockRejectedValue(
    new ApiError(429, "emergency_review_backlog"),
  );
  render(<Emergency settings={settings} />);
  await confirm();
  expect(await screen.findByText(/Core đã chạm giới hạn 5/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại cùng yêu cầu" }));
  await waitFor(() => expect(requestEmergency).toHaveBeenCalledTimes(2));
  expect(vi.mocked(requestEmergency).mock.calls[0][1]).toEqual(
    vi.mocked(requestEmergency).mock.calls[1][1],
  );
  expect(screen.queryByText("Bình giả lập", { exact: true })).toBeNull();
});
it("allergy-only access does not invent demographics", async () => {
  vi.mocked(requestEmergency).mockImplementation(async (_s, input) => ({
    ...input,
    capability: "allergy-list",
    executionId: "execution",
    source: "Clinic",
    receivedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    summary: {
      allergyState: "none-known",
      allergies: [],
      updatedAt: "2026-11-18T08:00:00Z",
    },
  }));
  render(<Emergency settings={settings} />);
  fireEvent.change(screen.getByLabelText(/Dữ liệu cần truy cập/), {
    target: { value: "allergy-list" },
  });
  await confirm();
  expect(await screen.findByText("Không có dị ứng đã biết")).toBeTruthy();
  expect(screen.getByText("Họ tên: Chưa rõ")).toBeTruthy();
  expect(screen.getByText(/Năng lực này không trả họ tên/)).toBeTruthy();
});
it("offers only permitted contracts and demo does not submit automatically", async () => {
  render(<Emergency settings={settings} demoEnabled />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Bình — thử truy cập cấp cứu" }),
  );
  expect(
    (screen.getByLabelText(/Mã định danh Junctura/) as HTMLInputElement).value,
  ).toBe(subject);
  expect(requestEmergency).not.toHaveBeenCalled();
  expect(screen.queryByRole("option", { name: /chuyển tuyến/ })).toBeNull();
  expect(
    await screen.findByText(/Kết quả hậu kiểm chỉ dành cho quản trị viên/),
  ).toBeTruthy();
});

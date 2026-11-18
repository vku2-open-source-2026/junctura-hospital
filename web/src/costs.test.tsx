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
import { CostForm, Costs, CostFailure } from "./Costs";
import { ApiError, createCost, listCosts, type CostRecord } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  createCost: vi.fn(),
  listCosts: vi.fn(),
}));
const settings = { issuer: "https://id.example.test", clientId: "hospital" },
  onCreated = vi.fn();
const cost: CostRecord = {
  id: "row",
  requestId: "request",
  admissionId: "admission",
  noteId: "note",
  items: [{ description: "Khoản giả lập", quantity: 2, unitPriceVnd: 100000 }],
  amountVnd: 200000,
  claimId: "HS-DEMO",
  createdAt: "2026-11-18T08:00:00Z",
  patientSubject: "patient",
  patientName: "Người bệnh giả lập",
  birthYear: 1968,
  sex: "male",
  insuranceStatus: "not-reported",
  createdBy: { subject: "doctor", displayName: "Bác sĩ giả lập" },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCosts).mockResolvedValue({ items: [], atCapacity: false });
});
afterEach(cleanup);
function form() {
  render(
    <CostForm
      settings={settings}
      admissionId="admission"
      noteId="note"
      disabled={false}
      onCreated={onCreated}
    />,
  );
  fireEvent.change(screen.getByLabelText(/Nội dung khoản 1/), {
    target: { value: "Khoản giả lập" },
  });
  fireEvent.change(screen.getByLabelText(/Số lượng khoản 1/), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText(/Đơn giá khoản 1/), {
    target: { value: "100000" },
  });
}
it("previews integer totals and requires explicit consequence acknowledgement", async () => {
  form();
  expect(screen.getByText(/Tổng dự kiến: 200.000/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Lưu hồ sơ chi phí" }));
  expect(createCost).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  vi.mocked(createCost).mockResolvedValue({ cost, created: true });
  fireEvent.click(screen.getByRole("button", { name: "Lưu hồ sơ chi phí" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(cost));
  expect(vi.mocked(createCost).mock.calls[0][1]).toMatchObject({
    admissionId: "admission",
    noteId: "note",
    confirmed: true,
    items: cost.items,
  });
  expect(screen.getByRole("status").textContent).toContain("Chưa có phản hồi");
});
it("rejects fractional price before calling backend and supports adding/removing cost lines", () => {
  form();
  fireEvent.change(screen.getByLabelText(/Đơn giá khoản 1/), {
    target: { value: "1.5" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Lưu hồ sơ chi phí" }));
  expect(createCost).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("nguyên VND");
  fireEvent.click(screen.getByRole("button", { name: "Thêm khoản chi phí" }));
  expect(screen.getByLabelText(/Nội dung khoản 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bỏ khoản 2" }));
  expect(screen.queryByLabelText(/Nội dung khoản 2/)).toBeNull();
});
it("unknown save outcome locks content and retries the exact request instead of a new claim", async () => {
  form();
  vi.mocked(createCost)
    .mockRejectedValueOnce(new ApiError(503, "cost_pending"))
    .mockResolvedValueOnce({ cost, created: false });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Lưu hồ sơ chi phí" }));
  const retry = await screen.findByRole("button", {
    name: "Thử lại cùng hồ sơ chi phí",
  });
  expect(screen.getByLabelText(/Nội dung khoản 1/).matches(":disabled")).toBe(
    true,
  );
  const first = vi.mocked(createCost).mock.calls[0][1];
  fireEvent.click(retry);
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(vi.mocked(createCost).mock.calls[1][1]).toEqual(first);
});
it("cost list shows empty and source/status without implying payment approval", async () => {
  const view = render(<Costs settings={settings} onExam={vi.fn()} />);
  expect(await screen.findByText("Chưa có hồ sơ chi phí")).toBeTruthy();
  view.unmount();
  vi.mocked(listCosts).mockResolvedValue({ items: [cost], atCapacity: false });
  render(<Costs settings={settings} onExam={vi.fn()} />);
  expect(await screen.findByText("HS-DEMO")).toBeTruthy();
  expect(screen.getByText("Chưa có phản hồi từ bảo hiểm")).toBeTruthy();
  expect(screen.getByText(/Hospital ·/)).toBeTruthy();
});
it("permission and unavailable states explain the next action", () => {
  const v = render(<CostFailure error={new ApiError(403)} />);
  expect(screen.getByText("Chưa có quyền thao tác chi phí")).toBeTruthy();
  v.rerender(<CostFailure error={new Error("offline")} />);
  expect(screen.getByText("Chưa hoàn tất thao tác chi phí")).toBeTruthy();
});

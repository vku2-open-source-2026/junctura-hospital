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
  getPrevisit,
  listAdmissions,
  openExamination,
  saveExamNote,
  type Admission,
  type SummaryResult,
} from "./api";
import { Examination, SummaryDetails } from "./Examination";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getPrevisit: vi.fn(),
  listAdmissions: vi.fn(),
  openExamination: vi.fn(),
  saveExamNote: vi.fn(),
}));
const settings = { issuer: "https://id.example.test", clientId: "hospital" };
const admission: Admission = {
  id: "admission",
  patientSubject: "patient",
  patientName: "Người bệnh An giả lập",
  birthYear: 1968,
  sex: "male",
  referralId: "CT-DEMO",
  urgency: "urgent",
  admittedAt: "2026-11-18T09:00:00Z",
  status: "called",
};
const summary: SummaryResult = {
  admissionId: admission.id,
  patientSubject: admission.patientSubject,
  executionId: "execution",
  receivedAt: "2026-11-18T09:00:00Z",
  source: "Trạm giả lập",
  summary: {
    patientName: admission.patientName,
    birthYear: 1968,
    sex: "male",
    allergyState: "recorded",
    allergies: [
      {
        substance: "Penicillin",
        severity: "severe",
        reaction: "Phản ứng giả lập",
      },
    ],
    chronicConditions: [],
    currentMedications: [],
    recentEncounters: [],
    updatedAt: "2026-11-18T08:00:00Z",
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listAdmissions).mockResolvedValue({
    items: [admission],
    atCapacity: false,
    limit: 100,
  });
  vi.mocked(openExamination).mockImplementation(async (_settings, id) => ({
    admission: {
      ...admission,
      id,
      patientName:
        id === "other" ? "Người bệnh khác giả lập" : admission.patientName,
    },
    notes: [],
    atCapacity: false,
  }));
});
afterEach(cleanup);
it("requires choosing a called person and never fetches clinical data automatically", async () => {
  render(<Examination settings={settings} onQueue={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mở khám/ }));
  await screen.findByRole("button", { name: "Tải tóm tắt trước khám" });
  expect(getPrevisit).not.toHaveBeenCalled();
  expect(screen.getByText("Không xem được dị ứng")).toBeTruthy();
});
it("shows treatment consent denial instead of implying no allergy", async () => {
  vi.mocked(getPrevisit).mockRejectedValue(
    new ApiError(403, "treatment_consent_required"),
  );
  render(
    <Examination
      settings={settings}
      initialId={admission.id}
      onQueue={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Tải tóm tắt trước khám" }),
  );
  expect(await screen.findByText("Chưa có đồng thuận điều trị")).toBeTruthy();
  expect(screen.getByText("Không xem được dị ứng")).toBeTruthy();
  expect(screen.queryByText("Không có dị ứng đã biết")).toBeNull();
});
it.each(["recorded", "none-known", "not-recorded"] as const)(
  "preserves allergy state %s with source and time",
  async (state) => {
    vi.mocked(getPrevisit).mockResolvedValue({
      ...summary,
      summary: {
        ...summary.summary,
        allergyState: state,
        allergies: state === "recorded" ? summary.summary.allergies : [],
      },
    });
    render(
      <Examination
        settings={settings}
        initialId={admission.id}
        onQueue={() => {}}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Tải tóm tắt trước khám" }),
    );
    expect(await screen.findByText(/Trạm giả lập/)).toBeTruthy();
    expect(
      screen.getByText(
        {
          recorded: "Có dị ứng đã ghi nhận",
          "none-known": "Không có dị ứng đã biết",
          "not-recorded": "Chưa ghi nhận dị ứng",
        }[state],
      ),
    ).toBeTruthy();
    if (state === "recorded")
      expect(screen.getByText("Có dị ứng nặng đã ghi nhận")).toBeTruthy();
  },
);
it("late summary from a previous person cannot appear after changing patient", async () => {
  let finish!: (value: SummaryResult) => void;
  vi.mocked(getPrevisit).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(listAdmissions).mockResolvedValue({
    items: [
      { ...admission, id: "other", patientName: "Người bệnh khác giả lập" },
    ],
    atCapacity: false,
    limit: 100,
  });
  render(
    <Examination
      settings={settings}
      initialId={admission.id}
      onQueue={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Tải tóm tắt trước khám" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Chọn người bệnh khác" }));
  fireEvent.click(await screen.findByRole("button", { name: /Mở khám/ }));
  await screen.findByRole("button", { name: "Tải tóm tắt trước khám" });
  finish(summary);
  await waitFor(() => expect(screen.queryByText("Trạm giả lập")).toBeNull());
  expect(screen.queryByText("Penicillin")).toBeNull();
});
it("uncertain saves retain the same request and content instead of creating another note", async () => {
  vi.mocked(saveExamNote)
    .mockRejectedValueOnce(new ApiError(503, "note_pending"))
    .mockImplementation(async (_settings, input) => ({
      created: false,
      note: {
        ...input,
        id: "note",
        createdAt: "2026-11-18T09:00:00Z",
        createdBy: { subject: "doctor", displayName: "Bác sĩ giả lập" },
      },
    }));
  render(
    <Examination
      settings={settings}
      initialId={admission.id}
      onQueue={() => {}}
    />,
  );
  await screen.findByLabelText(/Lý do khám/);
  for (const [label, text] of [
    ["Lý do khám", "Lý do giả lập"],
    ["Khám và ghi nhận", "Ghi nhận giả lập"],
    ["Chẩn đoán / nhận định của bác sĩ", "Nhận định giả lập"],
    ["Xử trí / kế hoạch", "Kế hoạch giả lập"],
  ])
    fireEvent.change(
      screen.getByLabelText(new RegExp(label.replace("/", "\\/"))),
      { target: { value: text } },
    );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Lưu ghi nhận khám" }));
  const retry = await screen.findByRole("button", {
    name: "Thử lưu lại cùng nội dung",
  });
  expect(
    (screen.getByLabelText(/Lý do khám/) as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(retry);
  expect(
    await screen.findByText("Đã lưu ghi nhận khám vào Junctura."),
  ).toBeTruthy();
  expect(saveExamNote).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveExamNote).mock.calls[0][1]).toEqual(
    vi.mocked(saveExamNote).mock.calls[1][1],
  );
});

it("date-only history never invents a visit time and identity differences are explicit", () => {
  render(
    <SummaryDetails
      admission={admission}
      value={{
        ...summary,
        summary: {
          ...summary.summary,
          patientName: "Tên từ trạm khác",
          recentEncounters: [
            {
              date: "2026-11-09",
              reason: "Lần khám giả lập",
              diagnosis: { code: "", name: "Nhận định giả lập" },
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText("09/11/2026")).toBeTruthy();
  expect(screen.getByText("Thông tin định danh khác nhau")).toBeTruthy();
  expect(screen.queryByText(/07:00/)).toBeNull();
});

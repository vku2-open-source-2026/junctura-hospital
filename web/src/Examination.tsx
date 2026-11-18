// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PatientBanner,
  PermissionState,
  QueueList,
  Section,
  Skeleton,
  SourceBadge,
  StaleNotice,
  TextAreaField,
  TextField,
  Timeline,
  formatDate,
  formatDateTime,
} from "@junctura/health-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  getPrevisit,
  listAdmissions,
  openExamination,
  saveExamNote,
  type Admission,
  type ExaminationResult,
  type NoteInput,
  type SummaryResult,
} from "./api";
import type { OidcSettings } from "./auth";
export function ExaminationFailure({ error }: { error: unknown }) {
  const code =
    error instanceof ApiError ? error.code : "examinations_unavailable";
  if (code === "treatment_consent_required")
    return (
      <PermissionState title="Chưa có đồng thuận điều trị">
        Người bệnh cần cho Hospital xem tóm tắt trước khám với mục đích điều
        trị. Quyền xem phiếu chuyển tuyến chưa bao gồm quyền này. Sau khi được
        cấp, bấm tải lại tóm tắt.
      </PermissionState>
    );
  if (code === "sign_in_required")
    return (
      <PermissionState title="Phiên đăng nhập đã hết hạn">
        Đăng nhập lại để tiếp tục.
      </PermissionState>
    );
  if (
    code === "summary_access_denied" ||
    code === "summary_capability_unavailable" ||
    (error instanceof ApiError && error.status === 403)
  )
    return (
      <PermissionState title="Chưa có quyền xem dữ liệu">
        Liên hệ quản trị viên kiểm tra quyền Hospital và quyền dùng tóm tắt
        trước khám.
      </PermissionState>
    );
  const message =
    code === "patient_not_called"
      ? "Người bệnh chưa được gọi vào khám hoặc lượt đã hủy. Kiểm tra hàng đợi trước."
      : code === "note_capacity_reached"
        ? "Môi trường demo đã đạt giới hạn ghi nhận. Liên hệ quản trị viên."
        : code === "invalid_note"
          ? "Kiểm tra các mục bắt buộc và độ dài nội dung trước khi lưu."
          : code === "note_request_conflict"
            ? "Mã thao tác đã được dùng cho nội dung khác. Kiểm tra ghi nhận đã lưu trước khi tạo bản bổ sung."
            : "Chưa xác nhận được kết quả. Thử tải lại; nếu đang lưu ghi nhận, kiểm tra kết quả lưu trước khi tạo bản mới.";
  return <ErrorState title="Chưa hoàn tất thao tác khám">{message}</ErrorState>;
}
export function Examination({
  settings,
  initialId,
  onQueue,
}: {
  settings: OidcSettings;
  initialId?: string | null;
  onQueue: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [items, setItems] = useState<Admission[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError(null);
    listAdmissions(settings, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setItems(result.items.filter((item) => item.status === "called"));
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [settings.issuer, settings.clientId, refresh]);
  if (selected)
    return (
      <ExamPatient
        key={selected}
        settings={settings}
        admissionId={selected}
        onBack={() => {
          setSelected(null);
          setRefresh((value) => value + 1);
        }}
      />
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onQueue}>
          Về hàng đợi
        </Button>
        <Button
          variant="secondary"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Làm mới danh sách
        </Button>
      </div>
      <p className="text-sm text-muted">
        Chọn người bệnh đã được gọi vào khám. Trạng thái đã gọi chưa có nghĩa là
        đã khám xong.
      </p>
      {error ? (
        <ExaminationFailure error={error} />
      ) : !items ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có người bệnh được gọi">
          Gọi người bệnh trong Hàng đợi, sau đó quay lại mở lượt khám.
        </EmptyState>
      ) : (
        <QueueList
          label="Người bệnh đã được gọi để khám"
          items={items.map((item, index) => ({
            id: item.id,
            ticket: String(index + 1).padStart(2, "0"),
            name: item.patientName,
            meta: item.referralId,
            note: item.fromFacility,
          }))}
          onOpen={(item) => setSelected(item.id)}
          openLabel="Mở khám"
        />
      )}
    </div>
  );
}
function ExamPatient({
  settings,
  admissionId,
  onBack,
}: {
  settings: OidcSettings;
  admissionId: string;
  onBack: () => void;
}) {
  const [value, setValue] = useState<ExaminationResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryError, setSummaryError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setValue(null);
    openExamination(settings, admissionId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          if (result.admission.id !== admissionId)
            throw new Error("context mismatch");
          setValue(result);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [settings.issuer, settings.clientId, admissionId, refresh]);
  useEffect(() => () => pending.current?.abort(), []);
  async function loadSummary() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSummary(null);
    setSummaryError(null);
    setLoading(true);
    try {
      const result = await getPrevisit(
        settings,
        admissionId,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        if (
          result.admissionId !== admissionId ||
          result.patientSubject !== value?.admission.patientSubject
        )
          throw new Error("context mismatch");
        setSummary(result);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setSummaryError(failure);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const admission = value?.admission;
  return (
    <div className="space-y-6 [&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip">
      <Button variant="secondary" onClick={onBack}>
        Chọn người bệnh khác
      </Button>
      {admission && (
        <PatientBanner
          name={admission.patientName}
          recordId={admission.patientSubject}
          birthYear={admission.birthYear}
          sex={admission.sex}
          allergy={
            summary
              ? {
                  state: summary.summary.allergyState,
                  items: summary.summary.allergies.map(
                    (item) =>
                      `${item.substance} · ${{ mild: "Nhẹ", moderate: "Vừa", severe: "Nặng" }[item.severity]} · ${item.reaction}`,
                  ),
                }
              : {
                  state: "unavailable",
                  reason:
                    "Chưa tải được tóm tắt từ trạm cho mục đích điều trị.",
                }
          }
          extra={
            <span>
              Phiếu: {admission.referralId} · định danh do bệnh viện đối chiếu
            </span>
          }
        />
      )}
      {error ? (
        <>
          <ExaminationFailure error={error} />
          <Button onClick={() => setRefresh((value) => value + 1)}>
            Tải lại lượt khám
          </Button>
        </>
      ) : !value ? (
        <Skeleton lines={5} />
      ) : (
        <>
          <Section
            title="Tóm tắt trước khám từ trạm"
            description="Mục đích điều trị. Junctura kiểm tra quyền, đồng thuận và ghi nhật ký mỗi lần tải."
          >
            <Button onClick={() => void loadSummary()} disabled={loading}>
              {loading
                ? "Đang tải tóm tắt…"
                : summary
                  ? "Tải lại tóm tắt"
                  : "Tải tóm tắt trước khám"}
            </Button>
            {loading && <Skeleton lines={5} />}
            {summaryError ? <ExaminationFailure error={summaryError} /> : null}
            {!summary && !loading && !summaryError && (
              <p className="text-sm text-muted">
                Chưa tải dữ liệu từ trạm. Không thể kết luận người bệnh không có
                dị ứng.
              </p>
            )}
            {summary && (
              <SummaryDetails value={summary} admission={value.admission} />
            )}
          </Section>
          <NoteForm
            settings={settings}
            value={value}
            onSaved={(note) =>
              setValue((current) =>
                current
                  ? {
                      ...current,
                      notes: [
                        note,
                        ...current.notes.filter((item) => item.id !== note.id),
                      ],
                    }
                  : current,
              )
            }
          />
          <Section
            title="Ghi nhận tại bệnh viện"
            description="Tách biệt với dữ liệu từ trạm. Mỗi lần lưu là một ghi nhận mới, giữ nguyên các bản trước."
          >
            {value.notes.length === 0 ? (
              <EmptyState title="Chưa có ghi nhận khám">
                Nhập kết quả khám bên trên rồi lưu; đây không phải dữ liệu tự
                lấy từ trạm.
              </EmptyState>
            ) : (
              <Timeline
                label="Các ghi nhận khám tại bệnh viện"
                items={value.notes.map((note) => ({
                  id: note.id,
                  time: note.createdAt,
                  title: `${note.createdBy.displayName} · ${note.diagnosis.name}`,
                  description: (
                    <dl className="space-y-2 whitespace-pre-wrap break-words">
                      {[
                        ["Lý do khám", note.reason],
                        ["Khám và ghi nhận", note.findings],
                        [
                          "Chẩn đoán",
                          [note.diagnosis.code, note.diagnosis.name]
                            .filter(Boolean)
                            .join(" · "),
                        ],
                        ["Xử trí / kế hoạch", note.plan],
                      ].map(([label, text]) => (
                        <div key={label}>
                          <dt className="text-sm text-muted">{label}</dt>
                          <dd>{text}</dd>
                        </div>
                      ))}
                    </dl>
                  ),
                }))}
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}
export function SummaryDetails({
  value,
  admission,
}: {
  value: SummaryResult;
  admission: Admission;
}) {
  const data = value.summary;
  const mismatch =
    data.patientName.normalize("NFC").trim() !==
      admission.patientName.normalize("NFC").trim() ||
    (admission.birthYear !== null && data.birthYear !== admission.birthYear) ||
    (["male", "female"].includes(admission.sex) && data.sex !== admission.sex);
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <SourceBadge source="Trạm y tế" unit={value.source} />
        <Badge>Nhận lúc {formatDateTime(value.receivedAt)}</Badge>
      </div>
      <StaleNotice updatedAt={data.updatedAt} maxAgeDays={90} />
      <p className="text-sm text-muted">
        Định danh tại trạm: {data.patientName} · sinh {data.birthYear} ·{" "}
        {{ male: "Nam", female: "Nữ", other: "Khác" }[data.sex] ?? "Chưa rõ"}.
        Thanh định danh phía trên giữ thông tin bệnh viện đã đối chiếu.
      </p>
      {mismatch && (
        <AlertBanner level="warning" title="Thông tin định danh khác nhau">
          Thông tin từ trạm khác thông tin đã đối chiếu tại bệnh viện. Kiểm tra
          đúng người bệnh trước khi sử dụng dữ liệu.
        </AlertBanner>
      )}
      {data.allergies.some((item) => item.severity === "severe") && (
        <AlertBanner level="warning" title="Có dị ứng nặng đã ghi nhận">
          {data.allergies
            .filter((item) => item.severity === "severe")
            .map((item) => `${item.substance}: ${item.reaction}`)
            .join("; ")}
        </AlertBanner>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Bệnh mạn tính">
          {data.chronicConditions.length === 0 ? (
            <p>Trạm chưa cung cấp mục bệnh mạn tính.</p>
          ) : (
            <ul className="space-y-2">
              {data.chronicConditions.map((item, index) => (
                <li key={index}>
                  {item.code} · {item.name} · từ {formatDate(item.since)}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Thuốc đang dùng theo trạm">
          {data.currentMedications.length === 0 ? (
            <p>Trạm chưa cung cấp mục thuốc đang dùng.</p>
          ) : (
            <ul className="space-y-2">
              {data.currentMedications.map((item, index) => (
                <li key={index}>
                  {item.name} · {item.dose} · từ {formatDate(item.since)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="Lần khám gần đây tại trạm">
        {data.recentEncounters.length === 0 ? (
          <p>Không có lần khám trong dữ liệu trả về từ trạm.</p>
        ) : (
          <ul aria-label="Lịch sử từ trạm" className="space-y-3">
            {data.recentEncounters.map((item, index) => (
              <li key={index} className="whitespace-pre-wrap break-words">
                <p className="text-sm text-muted">{formatDate(item.date)}</p>
                <p>{item.reason}</p>
                <p>
                  {item.diagnosis.code} · {item.diagnosis.name}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
function NoteForm({
  settings,
  value,
  onSaved,
}: {
  settings: OidcSettings;
  value: ExaminationResult;
  onSaved: (note: ExaminationResult["notes"][number]) => void;
}) {
  const [reason, setReason] = useState("");
  const [findings, setFindings] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const attempt = useRef<NoteInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  function success(note: ExaminationResult["notes"][number]) {
    onSaved(note);
    attempt.current = null;
    setUncertain(false);
    setReason("");
    setFindings("");
    setCode("");
    setName("");
    setPlan("");
    setConfirmed(false);
    setSaved(true);
    setError(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    attempt.current ??= {
      admissionId: value.admission.id,
      requestId: crypto.randomUUID(),
      reason,
      findings,
      diagnosis: { code, name },
      plan,
    };
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await saveExamNote(
        settings,
        attempt.current,
        controller.signal,
      );
      if (!controller.signal.aborted) success(result.note);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure);
        if (
          failure instanceof ApiError &&
          failure.status < 500 &&
          failure.code !== "note_request_conflict"
        ) {
          attempt.current = null;
          setUncertain(false);
        } else setUncertain(true);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function reconcile() {
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const latest = await openExamination(
        settings,
        value.admission.id,
        controller.signal,
      );
      const prior = latest.notes.find(
        (note) => note.requestId === attempt.current?.requestId,
      );
      if (!controller.signal.aborted) {
        if (prior) success(prior);
        else setError(new ApiError(503, "note_pending"));
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const locked = busy || uncertain;
  return (
    <Section
      title="Ghi khám tại bệnh viện"
      description="Nội dung do bác sĩ nhập. Bản chưa lưu sẽ mất khi đổi màn hình; không tự sao chép kết quả từ trạm."
    >
      <form className="space-y-4" onSubmit={submit}>
        <TextField
          label="Lý do khám"
          required
          maxLength={240}
          value={reason}
          disabled={locked}
          onChange={(event) => setReason(event.target.value)}
        />
        <TextAreaField
          label="Khám và ghi nhận"
          required
          maxLength={1200}
          value={findings}
          disabled={locked}
          onChange={(event) => setFindings(event.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Mã ICD-10 (nếu đã đối chiếu)"
            maxLength={16}
            value={code}
            disabled={locked}
            onChange={(event) => setCode(event.target.value)}
          />
          <TextField
            label="Chẩn đoán / nhận định của bác sĩ"
            required
            maxLength={160}
            value={name}
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <TextAreaField
          label="Xử trí / kế hoạch"
          required
          maxLength={1000}
          value={plan}
          disabled={locked}
          onChange={(event) => setPlan(event.target.value)}
        />
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={locked}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Tôi đã đối chiếu đúng người bệnh và kiểm tra nội dung. Ghi nhận đã lưu
          sẽ được giữ nguyên; bổ sung bằng một ghi nhận mới.
        </label>
        <Button
          type="submit"
          disabled={
            busy ||
            value.atCapacity ||
            !confirmed ||
            !reason.trim() ||
            !findings.trim() ||
            !name.trim() ||
            !plan.trim()
          }
        >
          {busy
            ? "Đang lưu…"
            : uncertain
              ? "Thử lưu lại cùng nội dung"
              : "Lưu ghi nhận khám"}
        </Button>
        {uncertain && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void reconcile()}
          >
            Kiểm tra kết quả lưu
          </Button>
        )}
      </form>
      {saved && <p role="status">Đã lưu ghi nhận khám vào Junctura.</p>}
      {error ? <ExaminationFailure error={error} /> : null}
      {value.atCapacity && (
        <AlertBanner level="notice" title="Đã chạm giới hạn demo">
          Chỉ hỗ trợ tối đa 100 ghi nhận. Liên hệ quản trị viên trước khi nhập
          thêm.
        </AlertBanner>
      )}
    </Section>
  );
}

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IdChip,
  PatientBanner,
  Section,
  SelectField,
  Skeleton,
  SourceBadge,
  StaleNotice,
  TextAreaField,
  TextField,
  formatDateTime,
} from "@junctura/health-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  listPrescriptions,
  openPrescriptions,
  checkPrescription,
  issuePrescription,
  type Prescription,
  type RxWorkspace,
  type RxItem,
  type RxCheck,
  type RxIssue,
} from "./api";
import type { OidcSettings } from "./auth";
import { ExaminationFailure } from "./Examination";
export function PrescriptionFailure({ error }: { error: unknown }) {
  const code =
    error instanceof ApiError ? error.code : "prescriptions_unavailable";
  if (
    [
      "treatment_consent_required",
      "summary_access_denied",
      "summary_capability_unavailable",
      "sign_in_required",
      "patient_not_called",
    ].includes(code)
  )
    return <ExaminationFailure error={error} />;
  const message =
    code === "allergy_review_required"
      ? "Kết quả dị ứng cần được rà soát. Đọc cảnh báo mới và ghi lý do trước khi thử phát hành lại."
      : code === "examination_note_required"
        ? "Lưu ghi nhận khám cho lượt này trước khi kê đơn."
        : code === "invalid_prescription" || code === "duplicate_medicine"
          ? "Kiểm tra danh mục thuốc, số lượng, cách dùng và không nhập trùng thuốc."
          : code === "prescription_capacity_reached"
            ? "Môi trường demo đã đạt 100 đơn. Liên hệ quản trị viên."
            : code === "prescription_request_conflict"
              ? "Mã thao tác đã dùng cho nội dung khác. Kiểm tra danh sách đơn trước khi tạo đơn mới."
              : "Chưa xác nhận được kết quả. Nếu đang phát hành, kiểm tra kết quả lưu trước khi tạo đơn mới.";
  return (
    <ErrorState title="Chưa hoàn tất thao tác kê đơn">{message}</ErrorState>
  );
}
export function Prescriptions({
  settings,
  initial,
  onExam,
}: {
  settings: OidcSettings;
  initial?: { admissionId: string; noteId: string } | null;
  onExam: () => void;
}) {
  const [selected, setSelected] = useState(initial ?? null),
    [items, setItems] = useState<Prescription[] | null>(null),
    [error, setError] = useState<unknown>(null),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setItems(null);
    setError(null);
    listPrescriptions(settings, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setItems(v.items);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [settings.issuer, settings.clientId, refresh]);
  if (selected)
    return (
      <PrescriptionPatient
        key={selected.admissionId + selected.noteId}
        settings={settings}
        initial={selected}
        onBack={() => {
          setSelected(null);
          setRefresh((v) => v + 1);
        }}
      />
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onExam}>Mở Khám để kê đơn</Button>
        <Button variant="secondary" onClick={() => setRefresh((v) => v + 1)}>
          Làm mới đơn thuốc
        </Button>
      </div>
      {error ? (
        <PrescriptionFailure error={error} />
      ) : !items ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có đơn thuốc">
          Lưu ghi nhận khám, rồi chọn Kê đơn từ ghi nhận đó.
        </EmptyState>
      ) : (
        items.map((item) => (
          <Section key={item.id} title={item.patientName}>
            <PrescriptionDetails value={item} />
            <Button
              variant="secondary"
              onClick={() =>
                setSelected({
                  admissionId: item.admissionId,
                  noteId: item.noteId,
                })
              }
            >
              Mở lượt kê đơn của {item.patientName}
            </Button>
          </Section>
        ))
      )}
    </div>
  );
}
function PrescriptionPatient({
  settings,
  initial,
  onBack,
}: {
  settings: OidcSettings;
  initial: { admissionId: string; noteId: string };
  onBack: () => void;
}) {
  const [value, setValue] = useState<RxWorkspace | null>(null),
    [error, setError] = useState<unknown>(null),
    [refresh, setRefresh] = useState(0),
    [check, setCheck] = useState<RxCheck | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setError(null);
    setValue(null);
    openPrescriptions(settings, initial.admissionId, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          if (v.admission.id !== initial.admissionId)
            throw Error("context mismatch");
          setValue(v);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [settings.issuer, settings.clientId, initial.admissionId, refresh]);
  const a = value?.admission;
  return (
    <div className="space-y-6 [&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip">
      <Button variant="secondary" onClick={onBack}>
        Về danh sách đơn
      </Button>
      {a && (
        <PatientBanner
          name={a.patientName}
          recordId={a.patientSubject}
          birthYear={a.birthYear}
          sex={a.sex}
          allergy={
            check
              ? {
                  state: check.allergy.allergyState,
                  items: check.allergy.allergies.map(
                    (v) =>
                      `${v.substance} · ${{ mild: "Nhẹ", moderate: "Vừa", severe: "Nặng" }[v.severity]} · ${v.reaction}`,
                  ),
                }
              : {
                  state: "unavailable",
                  reason: "Chưa kiểm tra dị ứng cho đơn đang nhập.",
                }
          }
        />
      )}
      {error ? (
        <>
          <PrescriptionFailure error={error} />
          <Button onClick={() => setRefresh((v) => v + 1)}>
            Tải lại lượt kê đơn
          </Button>
        </>
      ) : !value ? (
        <Skeleton lines={4} />
      ) : (
        <>
          {value.notes.length === 0 ? (
            <EmptyState title="Cần ghi nhận khám trước khi kê đơn">
              Vào Khám và lưu ghi nhận của lượt này.
            </EmptyState>
          ) : (
            <PrescriptionForm
              settings={settings}
              value={value}
              initialNote={initial.noteId}
              onCheck={setCheck}
              onIssued={(rx) =>
                setValue((current) =>
                  current
                    ? {
                        ...current,
                        prescriptions: [
                          rx,
                          ...current.prescriptions.filter(
                            (v) => v.id !== rx.id,
                          ),
                        ],
                      }
                    : current,
                )
              }
            />
          )}
          <Section title="Đơn của lượt khám này">
            {value.prescriptions.length === 0 ? (
              <p>Chưa phát hành đơn cho lượt này.</p>
            ) : (
              value.prescriptions.map((rx) => (
                <PrescriptionDetails key={rx.id} value={rx} />
              ))
            )}
          </Section>
        </>
      )}
    </div>
  );
}
export function PrescriptionDetails({ value }: { value: Prescription }) {
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap gap-2">
        <IdChip value={value.prescriptionCode} />
        <Badge tone={value.expired ? "warn" : "neutral"}>
          {value.expired ? "Đã hết hạn" : "Trong thời hạn ghi trên đơn"}
        </Badge>
        <Badge>
          {value.dispensed
            ? "Đã ghi nhận phát thuốc"
            : "Chưa ghi nhận phát thuốc"}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        {value.createdBy.displayName} · lập {formatDateTime(value.issuedAt)} ·
        hết hạn {formatDateTime(value.expiresAt)}
      </p>
      <ul className="space-y-3">
        {value.items.map((item, i) => (
          <li key={i} className="whitespace-pre-wrap break-words">
            <p className="font-semibold">
              {item.name} · {item.strength} · số lượng {item.quantity}
            </p>
            <p>{item.instructions}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
function PrescriptionForm({
  settings,
  value,
  initialNote,
  onCheck,
  onIssued,
}: {
  settings: OidcSettings;
  value: RxWorkspace;
  initialNote: string;
  onCheck: (value: RxCheck | null) => void;
  onIssued: (value: Prescription) => void;
}) {
  const [noteId, setNoteId] = useState(
    value.notes.some((v) => v.id === initialNote)
      ? initialNote
      : value.notes[0].id,
  );
  const [items, setItems] = useState<RxItem[]>([
      { name: "", strength: "", quantity: 1, instructions: "" },
    ]),
    [days, setDays] = useState(7),
    [check, setCheck] = useState<RxCheck | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [saved, setSaved] = useState(false);
  const pending = useRef<AbortController | null>(null),
    attempt = useRef<RxIssue | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const invalidate = () => {
    pending.current?.abort();
    setBusy(false);
    setCheck(null);
    onCheck(null);
    setError(null);
    setConfirmed(false);
    setSaved(false);
    setReason("");
  };
  const change = (index: number, patch: Partial<RxItem>) => {
    invalidate();
    setItems((values) =>
      values.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );
  };
  const ready =
    items.every(
      (v) =>
        v.name &&
        v.strength &&
        Number.isInteger(v.quantity) &&
        v.quantity >= 1 &&
        v.quantity <= 1000 &&
        v.instructions.trim(),
    ) &&
    days >= 1 &&
    days <= 30;
  async function assess(event: FormEvent) {
    event.preventDefault();
    invalidate();
    setBusy(true);
    const c = new AbortController();
    pending.current = c;
    try {
      const result = await checkPrescription(
        settings,
        { admissionId: value.admission.id, noteId, items, validDays: days },
        c.signal,
      );
      if (!c.signal.aborted) {
        if (result.patientSubject !== value.admission.patientSubject)
          throw Error("context mismatch");
        setCheck(result);
        onCheck(result);
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  function done(rx: Prescription) {
    onIssued(rx);
    attempt.current = null;
    setUncertain(false);
    setSaved(true);
    setCheck(null);
    onCheck(null);
    setConfirmed(false);
    setItems([{ name: "", strength: "", quantity: 1, instructions: "" }]);
    setReason("");
    setError(null);
  }
  async function issue() {
    setBusy(true);
    setSaved(false);
    setError(null);
    attempt.current ??= {
      admissionId: value.admission.id,
      noteId,
      items,
      validDays: days,
      requestId: crypto.randomUUID(),
      reviewConfirmed: confirmed,
      overrideReason: reason,
    };
    const c = new AbortController();
    pending.current = c;
    try {
      const result = await issuePrescription(
        settings,
        attempt.current,
        c.signal,
      );
      if (!c.signal.aborted) done(result.prescription);
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e);
        if (
          e instanceof ApiError &&
          e.status < 500 &&
          e.code !== "prescription_request_conflict"
        ) {
          attempt.current = null;
          setUncertain(false);
          if (
            e.check &&
            e.check.patientSubject === value.admission.patientSubject
          ) {
            setCheck(e.check);
            onCheck(e.check);
            setConfirmed(false);
          } else {
            setCheck(null);
            onCheck(null);
          }
        } else setUncertain(true);
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  async function reconcile() {
    setBusy(true);
    setError(null);
    const c = new AbortController();
    pending.current = c;
    try {
      const latest = await openPrescriptions(
        settings,
        value.admission.id,
        c.signal,
      );
      if (!c.signal.aborted) {
        const rx = latest.prescriptions.find(
          (v) => v.requestId === attempt.current?.requestId,
        );
        if (rx) done(rx);
        else setError(new ApiError(503, "prescription_pending"));
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  const locked = busy || uncertain;
  return (
    <Section
      title="Kê đơn từ ghi nhận khám"
      description="Chỉ dùng dữ liệu giả lập. Chọn thuốc từ danh mục chung; tự nhập số lượng và cách dùng. Bản chưa phát hành mất khi đổi màn hình."
    >
      <form onSubmit={assess} className="space-y-4">
        <SelectField
          label="Ghi nhận khám làm căn cứ"
          value={noteId}
          disabled={locked}
          options={value.notes.map((v) => ({
            value: v.id,
            label: `${formatDateTime(v.createdAt)} · {v.diagnosis.name}`,
          }))}
          onChange={(e) => {
            invalidate();
            setNoteId(e.target.value);
          }}
        />
        {items.map((item, index) => (
          <div
            key={index}
            className="space-y-3 rounded-lg border border-line bg-surface p-4"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <SelectField
                label={`Thuốc dòng ${index + 1}`}
                required
                placeholder="Chọn thuốc"
                value={item.name}
                disabled={locked}
                options={value.catalog.map((v) => ({
                  value: v.name,
                  label: v.name,
                }))}
                onChange={(e) => {
                  const selected = value.catalog.find(
                    (v) => v.name === e.target.value,
                  );
                  change(index, {
                    name: selected?.name ?? "",
                    strength: selected?.strength ?? "",
                  });
                }}
              />
              <TextField
                label={`Hàm lượng dòng ${index + 1}`}
                value={item.strength}
                readOnly
              />
              <TextField
                label={`Số lượng dòng ${index + 1}`}
                type="number"
                required
                min={1}
                max={1000}
                value={item.quantity}
                disabled={locked}
                onChange={(e) =>
                  change(index, { quantity: Number(e.target.value) })
                }
              />
            </div>
            <TextAreaField
              label={`Cách dùng dòng ${index + 1}`}
              required
              maxLength={240}
              value={item.instructions}
              disabled={locked}
              onChange={(e) => change(index, { instructions: e.target.value })}
            />
            {items.length > 1 && (
              <Button
                variant="secondary"
                disabled={locked}
                onClick={() => {
                  invalidate();
                  setItems((values) => values.filter((_, i) => i !== index));
                }}
              >
                Bỏ dòng {index + 1}
              </Button>
            )}
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={locked || items.length >= 20}
          onClick={() => {
            invalidate();
            setItems((values) => [
              ...values,
              { name: "", strength: "", quantity: 1, instructions: "" },
            ]);
          }}
        >
          Thêm thuốc
        </Button>
        <TextField
          label="Thời hạn đơn (ngày, giới hạn demo 1–30)"
          type="number"
          required
          min={1}
          max={30}
          value={days}
          disabled={locked}
          onChange={(e) => {
            invalidate();
            setDays(Number(e.target.value));
          }}
        />
        <Button type="submit" disabled={locked || !ready || value.atCapacity}>
          {busy ? "Đang kiểm tra…" : "Kiểm tra dị ứng và xem lại đơn"}
        </Button>
      </form>
      {check && (
        <div className="mt-5 space-y-4">
          <SourceBadge source="Trạm y tế" unit={check.source} />
          <StaleNotice updatedAt={check.allergy.updatedAt} maxAgeDays={365} />
          <p className="text-sm text-muted">
            Kiểm tra qua Junctura lúc {formatDateTime(check.checkedAt)}. Phát
            hành sẽ kiểm tra lại quyền và dữ liệu.
          </p>
          {check.conflicts.length > 0 ? (
            <AlertBanner level="critical" title="Thuốc trùng cảnh báo dị ứng">
              {check.conflicts.map((v, i) => (
                <p key={i}>
                  {v.medicine} · dị ứng {v.allergen} ·
                  {{ mild: "Nhẹ", moderate: "Vừa", severe: "Nặng" }[
                    v.severity
                  ] ?? v.severity}
                </p>
              ))}
            </AlertBanner>
          ) : (
            <AlertBanner
              level={
                check.allergy.allergyState === "not-recorded"
                  ? "warning"
                  : "notice"
              }
              title={
                check.allergy.allergyState === "not-recorded"
                  ? "Chưa ghi nhận dị ứng"
                  : "Chưa phát hiện khớp trong quy tắc demo"
              }
            >
              Kiểm tra này có phạm vi hạn chế; không kết luận thuốc an toàn và
              không thay thế việc bác sĩ rà soát.
            </AlertBanner>
          )}
          {check.stale && (
            <AlertBanner level="warning" title="Dữ liệu dị ứng có thể đã cũ">
              Đối chiếu lại trước khi tiếp tục.
            </AlertBanner>
          )}
          {check.reviewRequired && (
            <TextAreaField
              label="Lý do tiếp tục sau khi rà soát cảnh báo"
              required
              minLength={10}
              maxLength={500}
              value={reason}
              disabled={locked}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <Section title="Xem lại trước khi phát hành">
            <ul className="space-y-2">
              {items.map((v, i) => (
                <li key={i}>
                  {v.name} · {v.strength} · số lượng {v.quantity}
                  <p className="whitespace-pre-wrap break-words">
                    {v.instructions}
                  </p>
                </li>
              ))}
            </ul>
            <p>Thời hạn: {days} ngày từ lúc phát hành.</p>
          </Section>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi đã kiểm tra đúng người bệnh, ghi nhận khám, thuốc, cách dùng và
            các cảnh báo. Phát hành sẽ lưu đơn và mã đơn; bản này không sửa hoặc
            hủy trong giao diện demo.
          </label>
          <Button
            onClick={() => void issue()}
            disabled={
              busy ||
              !confirmed ||
              (check.reviewRequired && reason.trim().length < 10) ||
              value.atCapacity
            }
          >
            {busy
              ? "Đang phát hành…"
              : uncertain
                ? "Thử lại cùng thao tác phát hành"
                : "Phát hành đơn thuốc"}
          </Button>
        </div>
      )}
      {uncertain && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void reconcile()}
        >
          Kiểm tra kết quả phát hành
        </Button>
      )}
      {error ? <PrescriptionFailure error={error} /> : null}
      {saved && (
        <p role="status">
          Đã phát hành đơn thuốc trên Junctura. Xem mã đơn bên dưới.
        </p>
      )}
      {value.atCapacity && (
        <AlertBanner level="notice" title="Đã chạm giới hạn demo">
          Không tạo thêm đơn khi đã có 100 bản ghi.
        </AlertBanner>
      )}
    </Section>
  );
}

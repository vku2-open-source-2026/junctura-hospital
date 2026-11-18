// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IdChip,
  PatientBanner,
  PermissionState,
  Section,
  Skeleton,
  TextField,
  formatDateTime,
  formatNumber,
} from "@junctura/health-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  listCosts,
  openCosts,
  createCost,
  type CostInput,
  type CostRecord,
  type CostWorkspace,
} from "./api";
import type { OidcSettings } from "./auth";
const money = (n: number) => `${formatNumber(n)} ₫`;
export function CostFailure({ error }: { error: unknown }) {
  if (error instanceof ApiError && [401, 403].includes(error.status))
    return (
      <PermissionState title="Chưa có quyền thao tác chi phí">
        Đăng nhập lại hoặc nhờ quản trị viên kiểm tra quyền bác sĩ.
      </PermissionState>
    );
  const code = error instanceof ApiError ? error.code : "";
  return (
    <ErrorState title="Chưa hoàn tất thao tác chi phí">
      {code === "cost_note_required"
        ? "Cần ghi nhận khám đã lưu của đúng lượt này."
        : code === "cost_capacity_reached"
          ? "Demo đã đạt giới hạn 100 hồ sơ. Liên hệ quản trị viên."
          : code === "cost_request_conflict"
            ? "Mã thao tác đã dùng cho nội dung khác. Kiểm tra hồ sơ đã lưu."
            : "Chưa xác nhận được kết quả. Nếu đang lưu, thử lại cùng thao tác để kiểm tra kết quả trước khi tạo hồ sơ mới."}
    </ErrorState>
  );
}
export function CostDetails({ value }: { value: CostRecord }) {
  return (
    <div className="space-y-3 break-words">
      <IdChip value={value.claimId} label="Mã hồ sơ chi phí" />
      <p>
        Hospital · {formatDateTime(value.createdAt)} ·{" "}
        {value.createdBy.displayName}
      </p>
      {value.items.map((v, i) => (
        <p key={i}>
          {v.description} · {v.quantity} × {money(v.unitPriceVnd)} ={" "}
          {money(v.quantity * v.unitPriceVnd)}
        </p>
      ))}
      <p className="font-semibold">Tổng chi phí: {money(value.amountVnd)}</p>
      <Badge>Chưa có phản hồi từ bảo hiểm</Badge>
      <p>
        Hospital lưu hồ sơ chi phí. Chưa ghi nhận phê duyệt bảo hiểm hoặc thanh
        toán. Bảo hiểm chỉ xác minh mã hồ sơ và số tiền có khớp hay không qua
        Junctura.
      </p>
    </div>
  );
}
export function Costs({
  settings,
  initial,
  onExam,
}: {
  settings: OidcSettings;
  initial?: { admissionId: string; noteId: string } | null;
  onExam: () => void;
}) {
  const [selected, setSelected] = useState(initial ?? null),
    [items, setItems] = useState<CostRecord[] | null>(null),
    [error, setError] = useState<unknown>(null),
    [refresh, setRefresh] = useState(0),
    [capacity, setCapacity] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setItems(null);
    setError(null);
    listCosts(settings, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setItems(v.items);
          setCapacity(v.atCapacity);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [settings.issuer, settings.clientId, refresh]);
  if (selected)
    return (
      <CostPatient
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
        <Button onClick={onExam}>Mở Khám để lập chi phí</Button>
        <Button variant="secondary" onClick={() => setRefresh((v) => v + 1)}>
          Làm mới chi phí
        </Button>
      </div>
      {capacity && <p>Demo đã đạt giới hạn hồ sơ. Liên hệ quản trị viên.</p>}
      {error ? (
        <CostFailure error={error} />
      ) : !items ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có hồ sơ chi phí">
          Vào Khám, chọn ghi nhận đã lưu rồi lập chi phí từ ghi nhận đó.
        </EmptyState>
      ) : (
        items.map((v) => (
          <Section key={v.id} title={v.patientName}>
            <CostDetails value={v} />
            <Button
              variant="secondary"
              onClick={() =>
                setSelected({ admissionId: v.admissionId, noteId: v.noteId })
              }
            >
              Mở chi phí của {v.patientName}
            </Button>
          </Section>
        ))
      )}
    </div>
  );
}
function CostPatient({
  settings,
  initial,
  onBack,
}: {
  settings: OidcSettings;
  initial: { admissionId: string; noteId: string };
  onBack: () => void;
}) {
  const [value, setValue] = useState<CostWorkspace | null>(null),
    [error, setError] = useState<unknown>(null),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setValue(null);
    setError(null);
    openCosts(settings, initial.admissionId, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          if (
            v.admission.id !== initial.admissionId ||
            v.costs.some((r) => r.patientSubject !== v.admission.patientSubject)
          )
            throw Error("context mismatch");
          setValue(v);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [settings.issuer, settings.clientId, initial.admissionId, refresh]);
  const a = value?.admission,
    note = value?.notes.find((n) => n.id === initial.noteId);
  return (
    <div className="space-y-5">
      <Button variant="secondary" onClick={onBack}>
        Về danh sách chi phí
      </Button>
      {a && (
        <PatientBanner
          name={a.patientName}
          recordId={a.patientSubject}
          birthYear={a.birthYear}
          sex={a.sex}
          allergy={{
            state: "unavailable",
            reason: "Màn chi phí không tải dữ liệu dị ứng.",
          }}
        />
      )}
      {error ? (
        <>
          <CostFailure error={error} />
          <Button onClick={() => setRefresh((v) => v + 1)}>
            Tải lại lượt chi phí
          </Button>
        </>
      ) : !value ? (
        <Skeleton lines={4} />
      ) : (
        <>
          {note ? (
            <Section title="Lập hồ sơ chi phí">
              <p>
                Gắn với ghi nhận khám ngày {formatDateTime(note.createdAt)} của{" "}
                {note.createdBy.displayName}. Nhập đơn giá nguyên VND; kiểm tra
                trước khi lưu. Hồ sơ đã lưu không chỉnh sửa trong bản demo.
              </p>
              <CostForm
                settings={settings}
                admissionId={initial.admissionId}
                noteId={initial.noteId}
                disabled={value.atCapacity}
                onCreated={(cost) =>
                  setValue((v) =>
                    v
                      ? {
                          ...v,
                          costs: [
                            cost,
                            ...v.costs.filter(
                              (c) => c.requestId !== cost.requestId,
                            ),
                          ],
                        }
                      : v,
                  )
                }
              />
            </Section>
          ) : (
            <EmptyState title="Cần ghi nhận khám đã lưu">
              Vào Khám để chọn đúng ghi nhận của lượt này.
            </EmptyState>
          )}
          {value.costs.map((c) => (
            <Section key={c.id} title="Hồ sơ đã lưu">
              <CostDetails value={c} />
            </Section>
          ))}
        </>
      )}
    </div>
  );
}
export function CostForm({
  settings,
  admissionId,
  noteId,
  disabled,
  onCreated,
}: {
  settings: OidcSettings;
  admissionId: string;
  noteId: string;
  disabled: boolean;
  onCreated: (v: CostRecord) => void;
}) {
  const blank = () => ({ description: "", quantity: "1", unitPriceVnd: "" });
  const [lines, setLines] = useState([blank()]),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<CostInput | null>(null),
    [error, setError] = useState<unknown>(null),
    [validation, setValidation] = useState(""),
    [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const total = lines.reduce(
    (sum, v) => sum + Number(v.quantity) * Number(v.unitPriceVnd),
    0,
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || disabled || saved) return;
    setValidation("");
    let input = pending;
    if (!input) {
      if (
        !confirmed ||
        lines.some(
          (v) =>
            !v.description.trim() ||
            !/^\d+$/.test(v.quantity) ||
            !/^\d+$/.test(v.unitPriceVnd) ||
            Number(v.quantity) < 1 ||
            Number(v.quantity) > 1000,
        ) ||
        !Number.isSafeInteger(total) ||
        total > 1e12
      ) {
        setValidation(
          "Kiểm tra mô tả, số lượng 1–1000 và đơn giá nguyên VND. Tổng không vượt 1.000.000.000.000 VND. Xác nhận nội dung trước khi lưu.",
        );
        return;
      }
      input = {
        admissionId,
        noteId,
        requestId: crypto.randomUUID(),
        items: lines.map((v) => ({
          description: v.description.trim(),
          quantity: Number(v.quantity),
          unitPriceVnd: Number(v.unitPriceVnd),
        })),
        confirmed: true,
      };
      setPending(input);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createCost(settings, input);
      if (mounted.current) {
        onCreated(result.cost);
        setPending(null);
        setSaved(true);
      }
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <fieldset
        disabled={busy || !!pending || disabled || saved}
        className="space-y-4"
      >
        {lines.map((v, i) => (
          <div key={i} className="grid gap-3 xl:grid-cols-3">
            <TextField
              label={`Nội dung khoản ${i + 1}`}
              required
              maxLength={160}
              value={v.description}
              onChange={(e) =>
                setLines(
                  lines.map((r, j) =>
                    j === i ? { ...r, description: e.target.value } : r,
                  ),
                )
              }
            />
            <TextField
              label={`Số lượng khoản ${i + 1}`}
              required
              inputMode="numeric"
              value={v.quantity}
              onChange={(e) =>
                setLines(
                  lines.map((r, j) =>
                    j === i ? { ...r, quantity: e.target.value } : r,
                  ),
                )
              }
            />
            <TextField
              label={`Đơn giá khoản ${i + 1} (VND)`}
              required
              inputMode="numeric"
              value={v.unitPriceVnd}
              onChange={(e) =>
                setLines(
                  lines.map((r, j) =>
                    j === i ? { ...r, unitPriceVnd: e.target.value } : r,
                  ),
                )
              }
            />
            {lines.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                Bỏ khoản {i + 1}
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={lines.length >= 20}
          onClick={() => setLines([...lines, blank()])}
        >
          Thêm khoản chi phí
        </Button>
        <p>
          Tổng dự kiến:{" "}
          {Number.isSafeInteger(total) && total >= 0 && total <= 1e12
            ? money(total)
            : "Kiểm tra số tiền"}
          . Máy chủ tính lại khi lưu.
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Tôi đã đối chiếu đúng người bệnh, ghi nhận khám và các khoản chi
            phí. Hồ sơ lưu không chỉnh sửa trong bản demo.
          </span>
        </label>
      </fieldset>
      {validation && <p role="alert">{validation}</p>}
      {!!error && <CostFailure error={error} />}
      <Button type="submit" disabled={busy || disabled || saved}>
        {busy
          ? "Đang lưu chi phí…"
          : pending
            ? "Thử lại cùng hồ sơ chi phí"
            : saved
              ? "Đã lưu hồ sơ chi phí"
              : "Lưu hồ sơ chi phí"}
      </Button>
      {pending && !busy && (
        <p>
          Nội dung đang khóa để thử lại cùng mã thao tác. Không tạo hồ sơ mới
          khi chưa rõ kết quả.
        </p>
      )}
      {disabled && <p>Demo đã đạt giới hạn 100 hồ sơ.</p>}
      {saved && (
        <p role="status">
          Hồ sơ đã lưu qua Junctura. Chưa có phản hồi từ bảo hiểm.
        </p>
      )}
    </form>
  );
}

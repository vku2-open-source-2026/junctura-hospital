// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import {
  AlertBanner,
  Badge,
  Button,
  EmergencyBar,
  EmergencyDialog,
  EmptyState,
  ErrorState,
  PatientBanner,
  PermissionState,
  Section,
  SelectField,
  Skeleton,
  SourceBadge,
  StaleNotice,
  TextField,
  formatDateTime,
} from "@junctura/health-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  requestEmergency,
  endEmergency,
  emergencyHistory,
  getEmergencyDemo,
  type EmergencyCapability,
  type EmergencyInput,
  type EmergencyResult,
  type EmergencyHistoryResult,
} from "./api";
import type { OidcSettings } from "./auth";
import { SummaryDetails } from "./Examination";
const labels = {
  "pre-visit-summary": "Tóm tắt trước khám",
  "allergy-list": "Danh sách dị ứng",
};
export function EmergencyFailure({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : "emergency_unavailable";
  if (
    code === "summary_access_denied" ||
    code === "summary_capability_unavailable" ||
    code === "emergency_owner_required" ||
    (error instanceof ApiError && error.status === 403)
  )
    return (
      <PermissionState title="Chưa có quyền truy cập cấp cứu">
        Cấp cứu vẫn cần quyền Hospital và quyền gọi năng lực từ trạm. Liên hệ
        quản trị viên; không thay đổi đồng thuận để vượt lỗi này.
      </PermissionState>
    );
  const message =
    code === "emergency_review_backlog"
      ? "Core đã chạm giới hạn 5 lần cấp cứu chưa hậu kiểm của Hospital. Quản trị viên cần rà soát trong DX-OS trước khi tạo yêu cầu mới."
      : code === "invalid_emergency_access"
        ? "Đối chiếu mã người bệnh, chọn đúng dữ liệu và nhập lý do 10–500 ký tự, không có ký tự điều khiển."
        : code === "emergency_request_closed"
          ? "Yêu cầu đã kết thúc hoặc quá 5 phút. Kết thúc màn xem rồi xác nhận một yêu cầu mới nếu vẫn cần."
          : code === "emergency_request_conflict"
            ? "Mã yêu cầu đã gắn với nội dung khác. Không tự đổi người bệnh hoặc lý do để gửi lại cùng mã."
            : code === "emergency_capacity_reached"
              ? "Môi trường demo đã chạm giới hạn 100 yêu cầu. Liên hệ quản trị viên."
              : "Chưa xác nhận được kết quả. Core có thể đã ghi nhận yêu cầu. Kiểm tra lịch sử hoặc thử lại cùng yêu cầu, không bấm tạo liên tục.";
  return (
    <ErrorState title="Chưa hoàn tất truy cập cấp cứu">{message}</ErrorState>
  );
}
export function Emergency({
  settings,
  initialSubject,
  demoEnabled = false,
}: {
  settings: OidcSettings;
  initialSubject?: string | null;
  demoEnabled?: boolean;
}) {
  const [subject, setSubject] = useState(initialSubject ?? ""),
    [capability, setCapability] =
      useState<EmergencyCapability>("pre-visit-summary"),
    [identity, setIdentity] = useState(false),
    [dialog, setDialog] = useState(false),
    [active, setActive] = useState<EmergencyInput | null>(null),
    [value, setValue] = useState<EmergencyResult | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [demo, setDemo] = useState<{
      patientSubject: string;
      label: string;
    } | null>(null),
    [demoError, setDemoError] = useState(false),
    [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const c = new AbortController();
    if (demoEnabled)
      getEmergencyDemo(settings, c.signal)
        .then((v) => {
          if (!c.signal.aborted) setDemo(v);
        })
        .catch(() => {
          if (!c.signal.aborted) setDemoError(true);
        });
    return () => c.abort();
  }, [settings.issuer, settings.clientId, demoEnabled]);
  useEffect(() => {
    if (!value) return;
    const delay = Date.parse(value.expiresAt) - Date.now();
    const timer = setTimeout(
      () => {
        generation.current++;
        pending.current?.abort();
        setValue(null);
        setActive(null);
        setBusy(false);
        setIdentity(false);
        setNotice(
          "Đã đóng màn xem sau thời hạn 5 phút. Nhật ký và hậu kiểm Core vẫn được giữ.",
        );
        setRefresh((v) => v + 1);
      },
      Math.max(0, Math.min(delay, 300000)),
    );
    return () => clearTimeout(timer);
  }, [value?.operationId, value?.expiresAt]);
  function prepare(event: FormEvent) {
    event.preventDefault();
    if (
      !identity ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        subject.trim().toLowerCase(),
      )
    ) {
      setError(new ApiError(400, "invalid_emergency_access"));
      return;
    }
    setError(null);
    setDialog(true);
  }
  async function perform(input: EmergencyInput) {
    pending.current?.abort();
    const c = new AbortController();
    pending.current = c;
    const current = ++generation.current;
    setActive(input);
    setValue(null);
    setError(null);
    setNotice("");
    setBusy(true);
    try {
      const result = await requestEmergency(settings, input, c.signal);
      if (!c.signal.aborted && generation.current === current) {
        if (
          result.operationId !== input.operationId ||
          result.patientSubject !== input.patientSubject ||
          result.capability !== input.capability ||
          result.justification !== input.justification ||
          !Number.isFinite(Date.parse(result.expiresAt)) ||
          Date.parse(result.expiresAt) <= Date.now()
        )
          throw Error("context mismatch");
        setValue(result);
      }
    } catch (e) {
      if (!c.signal.aborted && generation.current === current) setError(e);
    } finally {
      if (!c.signal.aborted && generation.current === current) {
        setBusy(false);
        setRefresh((v) => v + 1);
      }
    }
  }
  function confirm(reason: string) {
    setDialog(false);
    if (
      [...reason.trim()].length < 10 ||
      [...reason.trim()].length > 500 ||
      /[\u0000-\u001f\u007f]/u.test(reason)
    ) {
      setError(new ApiError(400, "invalid_emergency_access"));
      return;
    }
    void perform({
      operationId: crypto.randomUUID(),
      patientSubject: subject.trim().toLowerCase(),
      capability,
      justification: reason.trim(),
      identityConfirmed: true,
      confirmed: true,
    });
  }
  async function end() {
    const input = active;
    generation.current++;
    pending.current?.abort();
    setActive(null);
    setValue(null);
    setBusy(false);
    setError(null);
    setIdentity(false);
    setNotice(
      "Đã xóa dữ liệu khỏi màn xem. Yêu cầu đã ghi nhận vẫn cần được hậu kiểm trên Core.",
    );
    if (input)
      try {
        await endEmergency(settings, input.operationId);
      } catch {
        setNotice(
          "Đã xóa dữ liệu khỏi màn xem nhưng chưa xác nhận đóng yêu cầu trên server. Yêu cầu cũ tự hết thời hạn sau 5 phút; nhật ký Core không bị xóa.",
        );
      }
    setRefresh((v) => v + 1);
  }
  return (
    <div className="space-y-6 [&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip">
      {active && (
        <div className="sticky top-[var(--jh-topbar,0px)] z-30 bg-app">
          <div className="max-h-48 overflow-y-auto">
            <EmergencyBar
              reason={active.justification}
              onEnd={() => void end()}
            />
          </div>
          <PatientBanner
            name={
              value?.capability === "pre-visit-summary"
                ? value.summary.patientName
                : "Họ tên: Chưa rõ"
            }
            recordId={active.patientSubject}
            birthYear={
              value?.capability === "pre-visit-summary"
                ? value.summary.birthYear
                : null
            }
            sex={
              value?.capability === "pre-visit-summary"
                ? value.summary.sex
                : null
            }
            allergy={
              value
                ? {
                    state: value.summary.allergyState,
                    items: value.summary.allergies.map(
                      (v) =>
                        `${v.substance} · ${{ mild: "Nhẹ", moderate: "Vừa", severe: "Nặng" }[v.severity]} · ${v.reaction}`,
                    ),
                  }
                : {
                    state: "unavailable",
                    reason: "Chưa nhận được dữ liệu trong yêu cầu này.",
                  }
            }
          />
        </div>
      )}
      {!active && (
        <>
          <AlertBanner
            level="warning"
            title="Truy cập dữ liệu trong tình huống cấp cứu"
          >
            Chỉ dùng khi có lý do cấp cứu và không thể xin đồng thuận kịp thời.
            Người bệnh và đơn vị quản lý có thể xem lại lần truy cập. Đây không
            phải quy trình tiếp nhận chuyển tuyến hoặc kê đơn.
          </AlertBanner>
          {demoEnabled && (
            <Section title="Thử bằng dữ liệu giả lập">
              {demo ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSubject(demo.patientSubject);
                    setIdentity(false);
                    setError(null);
                  }}
                >
                  {demo.label}
                </Button>
              ) : demoError ? (
                <p>Chưa tải được ca mẫu. Kiểm tra kết nối và đăng nhập.</p>
              ) : (
                <Skeleton lines={1} />
              )}
            </Section>
          )}
          <Section
            title="Xác định người bệnh và dữ liệu cần xem"
            description="Không cần phiếu chuyển tuyến hoặc lượt đã vào hàng đợi. Đối chiếu mã với đúng người bệnh trước khi yêu cầu."
          >
            <form className="space-y-4" onSubmit={prepare}>
              <TextField
                label="Mã định danh Junctura của người bệnh"
                value={subject}
                required
                maxLength={36}
                autoComplete="off"
                onChange={(e) => {
                  setSubject(e.target.value);
                  setIdentity(false);
                  setError(null);
                }}
              />
              <SelectField
                label="Dữ liệu cần truy cập cấp cứu"
                value={capability}
                options={[
                  {
                    value: "pre-visit-summary",
                    label: labels["pre-visit-summary"],
                  },
                  { value: "allergy-list", label: labels["allergy-list"] },
                ]}
                onChange={(e) => {
                  setCapability(e.target.value as EmergencyCapability);
                  setError(null);
                }}
              />
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={identity}
                  onChange={(e) => setIdentity(e.target.checked)}
                />
                Tôi đã đối chiếu mã với đúng người bệnh cần truy cập.
              </label>
              <Button type="submit" disabled={!identity || !subject.trim()}>
                Nhập lý do truy cập cấp cứu
              </Button>
            </form>
          </Section>
        </>
      )}
      <EmergencyDialog
        open={dialog}
        patientLabel={`${subject.trim()} · ${labels[capability]}`}
        onConfirm={confirm}
        onCancel={() => setDialog(false)}
      />
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {busy && <Skeleton lines={5} />}{" "}
      {error ? <EmergencyFailure error={error} /> : null}
      {active && !busy && !value && !!error && (
        <Button variant="secondary" onClick={() => void perform(active)}>
          Thử lại cùng yêu cầu
        </Button>
      )}
      {value && (
        <>
          <p className="text-sm text-muted">
            Dữ liệu cấp cứu chỉ hiển thị trong màn này, tối đa 5 phút cho yêu
            cầu hiện tại. Kết thúc hoặc đổi tab sẽ bỏ nội dung đang xem; không
            xóa nhật ký Core.
          </p>
          {value.capability === "pre-visit-summary" ? (
            <SummaryDetails
              value={{ ...value, admissionId: "", source: value.source }}
              admission={{
                patientName: value.summary.patientName,
                birthYear: value.summary.birthYear,
                sex: value.summary.sex,
              }}
              identityOrigin="clinic"
            />
          ) : (
            <Section title="Danh sách dị ứng từ trạm">
              <SourceBadge source="Clinic" />
              <StaleNotice
                updatedAt={value.summary.updatedAt}
                maxAgeDays={365}
              />
              <p className="text-sm text-muted">
                Nhận lúc {formatDateTime(value.receivedAt)}. Năng lực này không
                trả họ tên, năm sinh hoặc giới.
              </p>
              {value.summary.allergies.some((v) => v.severity === "severe") && (
                <AlertBanner level="warning" title="Có dị ứng nặng đã ghi nhận">
                  {value.summary.allergies
                    .filter((v) => v.severity === "severe")
                    .map((v) => `${v.substance}: ${v.reaction}`)
                    .join("; ")}
                </AlertBanner>
              )}
            </Section>
          )}
        </>
      )}
      <EmergencyHistory settings={settings} refresh={refresh} />
    </div>
  );
}
function EmergencyHistory({
  settings,
  refresh,
}: {
  settings: OidcSettings;
  refresh: number;
}) {
  const [value, setValue] = useState<EmergencyHistoryResult | null>(null),
    [error, setError] = useState<unknown>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError(null);
    setValue(null);
    emergencyHistory(settings, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setValue(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [settings.issuer, settings.clientId, refresh, attempt]);
  const states: Record<string, string> = {
    accepted: "Core đã nhận",
    running: "Đang thực hiện",
    succeeded: "Đã trả dữ liệu",
    failed: "Thực hiện không thành công",
    timed_out: "Hết thời gian thực hiện",
    auth_required: "Cần kiểm tra quyền",
    outcome_unknown: "Chưa rõ kết quả",
    unavailable: "Chưa đọc được trạng thái Core",
    unlinked: "Chưa xác nhận tác vụ Core",
  };
  const reviews: Record<string, string> = {
    pending: "Chờ hậu kiểm",
    justified: "Đã hậu kiểm: có căn cứ",
    unjustified: "Đã hậu kiểm: không có căn cứ",
  };
  return (
    <Section
      title="Yêu cầu cấp cứu của Hospital"
      description="Chỉ mục yêu cầu lưu trên Core, trạng thái thực hiện đối chiếu với Core. Đây không thay thế nhật ký bảo vệ hoặc quyết định hậu kiểm của nền tảng."
    >
      <Button variant="secondary" onClick={() => setAttempt((v) => v + 1)}>
        Làm mới yêu cầu cấp cứu
      </Button>
      {error ? (
        <EmergencyFailure error={error} />
      ) : !value ? (
        <Skeleton lines={3} />
      ) : (
        <>
          <p className="text-sm text-muted">
            Core giới hạn 5 lần truy cập chưa hậu kiểm cho Hospital.{" "}
            {value.reviewVisibility === "administrator"
              ? "Kết quả hậu kiểm chỉ dành cho quản trị viên có quyền trong DX-OS."
              : value.reviewVisibility === "unavailable"
                ? "Chưa đọc được kết quả hậu kiểm từ Core."
                : "Kết quả hậu kiểm dưới đây do Core cung cấp."}
          </p>
          {value.items.length === 0 ? (
            <EmptyState title="Chưa có yêu cầu cấp cứu">
              Chỉ tạo yêu cầu khi có tình huống cấp cứu và đã đối chiếu người
              bệnh.
            </EmptyState>
          ) : (
            <ul className="space-y-4">
              {value.items.map((v) => (
                <li
                  key={v.operationId}
                  className="space-y-2 rounded-lg border border-line bg-surface p-4"
                >
                  <p className="font-semibold">
                    {labels[v.capability]} · {v.createdBy.displayName}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDateTime(v.requestedAt)} · mã người bệnh{" "}
                    {v.patientSubject}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{states[v.state] ?? "Cần đối chiếu Core"}</Badge>
                    <Badge>
                      {v.reviewState
                        ? (reviews[v.reviewState] ?? "Cần đối chiếu hậu kiểm")
                        : "Quản trị viên hậu kiểm trên Core"}
                    </Badge>
                    {v.endedAt && <Badge>Đã đóng yêu cầu tại Hospital</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap break-words">
                    Lý do: {v.justification}
                  </p>
                  {v.executionId && (
                    <p className="break-all font-mono text-xs text-muted">
                      Tác vụ Core: {v.executionId}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {value.atCapacity && (
            <AlertBanner level="notice" title="Đã chạm giới hạn demo">
              Không tạo yêu cầu mới khi chỉ mục có 100 bản ghi.
            </AlertBanner>
          )}
        </>
      )}
    </Section>
  );
}

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AlertBanner, Badge, Button, EmptyState, ErrorState, PatientBanner, PermissionState, Section, Skeleton, SourceBadge, TextField, formatDateTime } from "@junctura/health-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, lookupReferral, type ReferralResult } from "./api";
import type { OidcSettings } from "./auth";

type State = { kind: "idle" } | { kind: "loading"; patientSubject: string } | { kind: "success"; value: ReferralResult } | { kind: "error"; code: string; patientSubject: string };
const urgency = { routine: "Thông thường", urgent: "Khẩn", emergency: "Cấp cứu" };
export function Intake({ settings }: { settings: OidcSettings }) {
  const [patientSubject, setPatientSubject] = useState("");
  const [referralId, setReferralId] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [validation, setValidation] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  const invalidate = () => { generation.current++; pending.current?.abort(); setState({ kind: "idle" }); setValidation(false); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const subject = patientSubject.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(subject) || !referralId.trim()) { setValidation(true); return; }
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const request = ++generation.current;
    setState({ kind: "loading", patientSubject: subject });
    try {
      const value = await lookupReferral(settings, { patientSubject: subject, referralId: referralId.trim() }, controller.signal);
      if (request !== generation.current) return;
      if (value.patientSubject !== subject || value.referralId !== referralId.trim()) throw new Error("context mismatch");
      setState({ kind: "success", value });
    } catch (error) {
      if (request !== generation.current || controller.signal.aborted) return;
      setState({ kind: "error", patientSubject: subject, code: error instanceof ApiError ? error.code : error instanceof DOMException && error.name === "TimeoutError" ? "referral_timeout" : "request_failed" });
    }
  }
  const activeSubject = state.kind === "loading" || state.kind === "error" ? state.patientSubject : state.kind === "success" ? state.value.patientSubject : null;
  return <div className="space-y-6 [&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip">
    {activeSubject && <>
      <PatientBanner name="Họ tên: Chưa rõ" recordId={activeSubject} allergy={{ state: "unavailable", reason: "Phiếu chuyển tuyến không cung cấp dữ liệu dị ứng." }}
        extra={<><span>Năm sinh: Chưa rõ</span><span>Giới: Chưa rõ</span></>} />
    </>}

    <Section title="Tra cứu phiếu chuyển tuyến" description="Dùng mã định danh Junctura do người bệnh cung cấp cùng mã phiếu của trạm y tế.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <TextField label="Mã định danh Junctura của người bệnh" hint="Mã định danh do người bệnh cung cấp; không phải họ tên hay mã BHYT." required autoComplete="off" spellCheck={false} maxLength={36}
            value={patientSubject} onChange={event => { invalidate(); setPatientSubject(event.target.value); }} error={validation ? "Nhập mã định danh Junctura dạng UUID của người bệnh." : undefined} />
          <TextField label="Mã phiếu chuyển tuyến" hint="Ví dụ CT-2026-000123; nhập đúng mã do trạm cung cấp." required autoComplete="off" maxLength={64}
            value={referralId} onChange={event => { invalidate(); setReferralId(event.target.value); }} />
        </div>
        <p className="text-sm text-muted">Mục đích: tiếp nhận chuyển tuyến. Junctura kiểm tra quyền và đồng thuận, ghi nhật ký mỗi lần gọi. Phiếu này không cho phép truy cập cấp cứu.</p>
        <Button type="submit" disabled={state.kind === "loading"}>{state.kind === "loading" ? "Đang tra cứu…" : "Tra cứu phiếu"}</Button>
      </form>
    </Section>
    {state.kind === "idle" && <EmptyState title="Chưa tra cứu phiếu">Nhập hai mã ở trên để xem phiếu qua Junctura. Chưa có hồ sơ nào được tiếp nhận vào hàng đợi.</EmptyState>}
    {state.kind === "loading" && <Skeleton lines={5} />}
    {state.kind === "error" && <ReferralFailure code={state.code} />}
    {state.kind === "success" && <ReferralDetails value={state.value} />}
  </div>;
}
export function ReferralFailure({ code }: { code: string }) {
  if (code === "subject_consent_required") return <PermissionState title="Chưa có đồng thuận">
    Nhờ người bệnh cấp đồng thuận cho Hospital đối với hồ sơ chuyển tuyến, mục đích tiếp nhận chuyển tuyến, trong MyHealth. Sau đó bấm tra cứu lại. Không thể dùng truy cập cấp cứu cho phiếu này.
  </PermissionState>;
  if (["forbidden", "referral_access_denied", "referral_capability_unavailable"].includes(code)) return <PermissionState title="Chưa có quyền tra cứu phiếu">
    Liên hệ quản trị viên kiểm tra ứng dụng Clinic, hợp đồng và quyền Hospital gọi hồ sơ chuyển tuyến qua Junctura.
  </PermissionState>;
  if (code === "sign_in_required") return <PermissionState title="Phiên đăng nhập đã hết hạn">Đăng xuất rồi đăng nhập lại qua Junctura để tiếp tục.</PermissionState>;
  const message = code === "referral_timeout" ? "Tra cứu quá thời gian chờ. Kiểm tra kết nối trước khi bấm tra cứu lại."
    : code === "invalid_lookup" ? "Kiểm tra mã người bệnh và mã phiếu rồi tra cứu lại."
    : code === "invalid_referral_output" ? "Phiếu trả về không đúng hợp đồng. Liên hệ đơn vị chuyển tuyến để kiểm tra."
    : code === "referral_provider_failed" ? "Không lấy được phiếu từ trạm. Kiểm tra đúng mã người bệnh, mã phiếu và kết nối với đơn vị chuyển tuyến."
    : "Kiểm tra kết nối Junctura và cấu hình nhà cung cấp, sau đó bấm tra cứu lại.";
  return <ErrorState title="Chưa lấy được phiếu chuyển tuyến">{message}</ErrorState>;
}
export function ReferralDetails({ value }: { value: ReferralResult }) {
  const item = value.referral;
  return <Section title={`Phiếu ${item.referralId}`} description="Kết quả tra cứu; chưa xác nhận tiếp nhận vào hàng đợi.">
    <div className="flex flex-wrap gap-2"><SourceBadge source="Clinic" unit={item.fromFacility} /><Badge>Phát hành {formatDateTime(item.issuedAt)}</Badge>
      <Badge tone={item.urgency === "routine" ? "neutral" : "warn"}>Mức khẩn: {urgency[item.urgency]}</Badge></div>
    <p className="text-sm text-muted">Nhận qua Junctura lúc {formatDateTime(value.receivedAt)}. Họ tên, năm sinh và giới không nằm trong hợp đồng phiếu; cần đối chiếu định danh trước khi tiếp nhận.</p>
    <dl className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
      {[ ["Nơi chuyển", item.fromFacility], ["Nơi nhận", item.toFacility], ["Lý do chuyển", item.reason],
        ["Chẩn đoán sơ bộ", [item.provisionalDiagnosis.code, item.provisionalDiagnosis.name].filter(Boolean).join(" · ")],
        ["Xử trí đã làm", item.treatmentGiven] ].map(([label, text]) => <div key={label} className="min-w-0"><dt className="text-sm text-muted">{label}</dt><dd className="whitespace-pre-wrap break-words text-ink">{text || "Chưa rõ"}</dd></div>)}
    </dl>
    <AlertBanner level="info" title="Đối chiếu trước khi tiếp nhận">Mức khẩn trên phiếu do nơi chuyển cung cấp. Bản này chỉ tra cứu, chưa ghi nhận lượt tiếp nhận hay thay thế đánh giá của bác sĩ.</AlertBanner>
  </Section>;
}

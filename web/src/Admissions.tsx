// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AlertBanner, Badge, Button, EmptyState, ErrorState, PermissionState, QueueList, Section, SelectField, Skeleton, TextField } from "@junctura/health-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, callAdmission, confirmAdmission, listAdmissions, type Admission, type DemoCase, type ReferralResult } from "./api";
import type { OidcSettings } from "./auth";
import { ReferralFailure } from "./ReferralFailure";
export function AdmissionFailure({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : "admissions_unavailable";
  if (["subject_consent_required", "referral_access_denied", "sign_in_required"].includes(code)) return <ReferralFailure code={code} />;
  if (error instanceof ApiError && error.status === 403) return <PermissionState>Liên hệ quản trị viên để kiểm tra quyền bệnh viện.</PermissionState>;
  const message = code === "invalid_admission" ? "Nhập tên, kiểm tra năm sinh và xác nhận đã đối chiếu đúng người bệnh."
    : code === "wrong_destination" ? "Phiếu không ghi bệnh viện này là nơi nhận. Liên hệ đơn vị chuyển tuyến để đối chiếu."
    : code === "admission_workflow_missing" ? "Quy trình tiếp nhận chưa được quản trị viên cấu hình. Liên hệ đơn vị vận hành."
    : code === "admission_capacity_reached" ? "Môi trường demo đã đạt giới hạn 100 bản ghi. Liên hệ quản trị viên."
    : "Chưa xác nhận được kết quả. Làm mới hàng đợi để kiểm tra trước khi thao tác lại; hệ thống sẽ nhận diện lượt đã tiếp nhận.";
  return <ErrorState title="Chưa hoàn tất thao tác tiếp nhận">{message}</ErrorState>;
}
export function AdmissionForm({ settings, result, suggested, onShowQueue }: { settings: OidcSettings; result: ReferralResult; suggested?: DemoCase | null; onShowQueue: () => void }) {
  const [name, setName] = useState(suggested?.patientName ?? "");
  const [year, setYear] = useState(suggested ? String(suggested.birthYear) : "");
  const [sex, setSex] = useState(suggested?.sex ?? "unknown");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{admission: Admission; created: boolean} | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    const controller = new AbortController(); pending.current = controller;
    try { const value = await confirmAdmission(settings, { patientSubject: result.patientSubject, referralId: result.referralId,
      patientName: name, birthYear: year ? Number(year) : null, sex, identityConfirmed: checked }, controller.signal);
      if (!controller.signal.aborted) setDone(value);
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  if (done) return <Section title={done.created ? "Đã tiếp nhận" : "Phiếu này đã được tiếp nhận trước đó"}>
    <AlertBanner level="info" title={done.admission.status === "called" ? "Người bệnh đã được gọi vào khám" : "Lượt tiếp nhận đã được lưu trên Junctura"}>
      {done.admission.patientName} · {done.admission.referralId}. Không tạo thêm lượt khi bấm lặp.
    </AlertBanner><Button onClick={onShowQueue}>Xem hàng đợi</Button>
  </Section>;
  return <Section title="Xác nhận tiếp nhận" description="Đối chiếu trực tiếp với người bệnh hoặc giấy tờ. Thông tin dưới đây do bệnh viện nhập, không lấy từ hợp đồng phiếu.">
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Họ tên đã đối chiếu" required maxLength={160} autoComplete="off" value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        <TextField label="Năm sinh (nếu biết)" type="number" min={1900} max={new Date().getFullYear()} value={year} disabled={busy} onChange={event => setYear(event.target.value)} />
        <SelectField label="Giới đã đối chiếu" value={sex} disabled={busy} onChange={event => setSex(event.target.value)} options={[{value:"unknown",label:"Chưa rõ"},{value:"male",label:"Nam"},{value:"female",label:"Nữ"}]} />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" checked={checked} required disabled={busy} onChange={event => setChecked(event.target.checked)} />Tôi đã đối chiếu mã người bệnh và phiếu chuyển tuyến với đúng người đang tiếp nhận.</label>
      <p className="text-sm text-muted">Bệnh viện kiểm tra lại quyền xem phiếu trước khi tạo lượt mới. Thao tác sẽ lưu thông tin tối thiểu vào Core và tạo quy trình chờ gọi vào khám.</p>
      <Button type="submit" disabled={!checked || !name.trim() || busy}>{busy ? "Đang xác nhận…" : "Xác nhận tiếp nhận"}</Button>
    </form>
    {error ? <AdmissionFailure error={error} /> : null}
  </Section>;
}
export function HospitalQueue({ settings, onIntake, onExamine }: { settings: OidcSettings; onIntake: () => void; onExamine?: (id: string) => void }) {
  const [items, setItems] = useState<Admission[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [capacity, setCapacity] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(null); setItems(null);
    listAdmissions(settings, controller.signal).then(value => { if (!controller.signal.aborted) { setItems(value.items); setCapacity(value.atCapacity); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [settings.issuer, settings.clientId, refresh]);
  async function call(item: Admission) {
    setBusy(true); setError(null);
    try { await callAdmission(settings, item.id); setRefresh(value => value + 1); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  const waiting = items?.filter(item => item.status === "waiting") ?? [];
  const called = items?.filter(item => item.status === "called") ?? [];
  const other = items?.filter(item => !["waiting", "called"].includes(item.status)) ?? [];
  const rows = (values: Admission[]) => values.map((item,index) => ({ id:item.id,ticket:String(index+1).padStart(2,"0"),name:item.patientName,
    meta:[item.birthYear ? `Sinh ${item.birthYear}` : "Năm sinh: Chưa rõ", item.referralId].join(" · "),since:item.status === "waiting" ? item.admittedAt : undefined,
    flags:<Badge tone={item.urgency === "routine" ? "neutral" : "warn"}>Phiếu: {{routine:"Thông thường",urgent:"Khẩn",emergency:"Cấp cứu"}[item.urgency]}</Badge>,
    note:item.fromFacility,
  }));
  return <div className="space-y-6">
    <div className="flex flex-wrap gap-2"><Button onClick={onIntake}>Tiếp nhận người bệnh</Button><Button variant="secondary" onClick={() => setRefresh(value => value + 1)} disabled={busy}>Làm mới hàng đợi</Button></div>
    <p className="text-sm text-muted">Sắp theo mức khẩn ghi trên phiếu rồi thời gian tiếp nhận. Vị trí hiển thị không phải số vé cố định. Đã gọi vào khám không đồng nghĩa đã khám xong.</p>
    {error ? <AdmissionFailure error={error} /> : null}
    {busy && <p role="status">Đang cập nhật quy trình trên Junctura…</p>}
    {!items && !error && <Skeleton lines={5} />}
    {items?.length === 0 && <EmptyState title="Chưa có lượt tiếp nhận">Mở Tiếp nhận, tra cứu phiếu và xác nhận đúng người bệnh để đưa vào hàng đợi.</EmptyState>}
    {items && items.length > 0 && <>
      <Section title="Đang chờ gọi vào khám" count={waiting.length}><QueueList label="Người bệnh đang chờ" items={rows(waiting)}
        onCall={!busy && !error ? row => { const item = waiting.find(value => value.id === row.id); if (item) void call(item); } : undefined} callLabel="Gọi vào khám" /></Section>
      <Section title="Đã gọi vào khám" count={called.length}><QueueList label="Người bệnh đã được gọi" items={rows(called)} onOpen={onExamine ? row => onExamine(row.id) : undefined} openLabel="Mở khám" /></Section>
      {other.length > 0 && <Section title="Cần kiểm tra trạng thái"><QueueList label="Lượt cần kiểm tra" items={rows(other)} /><p className="text-sm text-muted">Các lượt đã hủy hoặc chưa đọc được workflow không được tự coi là đang chờ. Làm mới hoặc liên hệ quản trị viên.</p></Section>}
    </>}
    {capacity && <AlertBanner level="notice" title="Đã chạm giới hạn demo">Chỉ đọc tối đa 100 bản ghi; hệ thống chặn tiếp nhận mới để không bỏ sót dữ liệu phía sau giới hạn này.</AlertBanner>}
  </div>;
}

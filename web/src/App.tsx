// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AppShell, Badge, Button, EmptyState, ErrorState, PageHeader, PermissionState, SignInPage, Skeleton, type NavGroup } from "@junctura/health-ui";
import { ClipboardList, FileInput, Pill, Receipt, ScrollText, ShieldAlert, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, getConfig, getMe, type Config, type Me } from "./api";
import { buildLogoutUrl, clearSession, completeLogin, loadSession, startLogin } from "./auth";
import { Landing } from "./Landing";

const pages = [
  { id: "queue", label: "Hàng đợi", icon: ClipboardList, description: "Người bệnh chờ khám và mức ưu tiên." },
  { id: "intake", label: "Tiếp nhận", icon: FileInput, description: "Tiếp nhận chuyển tuyến qua Junctura." },
  { id: "exam", label: "Khám", icon: Stethoscope, description: "Thông tin khám và dữ liệu có nguồn từ trạm y tế." },
  { id: "emergency", label: "Cấp cứu", icon: ShieldAlert, description: "Truy cập khẩn cấp có lý do và được hậu kiểm." },
  { id: "prescriptions", label: "Đơn thuốc", icon: Pill, description: "Đơn thuốc và trạng thái xác minh." },
  { id: "costs", label: "Chi phí", icon: Receipt, description: "Hồ sơ chi phí và xác minh cho bảo hiểm." },
  { id: "audit", label: "Nhật ký", icon: ScrollText, description: "Các lần trao đổi dữ liệu qua Junctura." },
];
const nav: NavGroup[] = [{ label: "Không gian bệnh viện", items: pages.map(({ id, label, icon: Icon }) => ({ id, label, icon: <Icon aria-hidden className="size-4" /> })) }];
type State = { kind: "loading" } | { kind: "signed-out"; message?: string } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; me: Me };

// Deduplicate the single-use PKCE callback when React StrictMode remounts effects.
let startup: Promise<{ config: Config; state: State }> | undefined;
async function loadApplication() {
  const config = await getConfig();
  const callback = new URLSearchParams(location.search);
  if (callback.has("code") || callback.has("error")) {
    try { await completeLogin(config, location.search); }
    catch { clearSession(); return { config, state: { kind: "signed-out", message: "Đăng nhập chưa hoàn tất. Vui lòng thử lại." } as State }; }
    finally { history.replaceState(null, "", location.pathname + location.hash); }
  }
  if (!loadSession()) return { config, state: { kind: "signed-out" } as State };
  try { return { config, state: { kind: "ready", me: await getMe(config) } as State }; }
  catch (error) {
    if (error instanceof ApiError && error.status === 403) return { config, state: { kind: "forbidden" } as State };
    if (error instanceof ApiError && error.status === 401) {
      clearSession(); return { config, state: { kind: "signed-out", message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." } as State };
    }
    throw error;
  }
}
export function Workspace({ me, facility, onSignOut }: { me: Me; facility: string; onSignOut: () => void }) {
  const [current, setCurrent] = useState("queue");
  const page = pages.find(item => item.id === current)!;
  return <AppShell product="Hospital" nav={nav} current={current} onNavigate={setCurrent}
    unit={{ name: facility }} user={{ name: me.displayName, role: "Bác sĩ", unit: facility }} onSignOut={onSignOut}
    status={<Badge>Bản khởi tạo</Badge>}>
    <PageHeader title={page.label} description={page.description} badges={<Badge>Chưa triển khai</Badge>} />
    <EmptyState title="Chức năng đang được xây dựng">
      Bản khởi tạo chưa xử lý hồ sơ người bệnh. Vui lòng dùng phiên bản đã được đơn vị xác nhận khi tính năng hoàn tất.
    </EmptyState>
  </AppShell>;
}
export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [signInPage, setSignInPage] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    startup ??= loadApplication();
    startup.then(result => { if (active) { setConfig(result.config); setState(result.state); if (result.state.kind === "signed-out" && result.state.message) setSignInPage(true); } })
      .catch(() => { if (active) setState({ kind: "error" }); });
    return () => { active = false; };
  }, [attempt]);
  const retry = () => { startup = undefined; setState({ kind: "loading" }); setAttempt(value => value + 1); };
  const signIn = () => { if (config) startLogin(config).catch(() => setState({ kind: "signed-out", message: "Không mở được đăng nhập. Vui lòng thử lại." })); };
  const signOut = () => {
    const session = loadSession(); clearSession(); startup = undefined;
    if (config) location.assign(buildLogoutUrl(config, `${location.origin}/`, session?.idToken));
  };
  if (state.kind === "loading") return <main className="mx-auto max-w-3xl p-6"><Skeleton lines={5} /></main>;
  if (state.kind === "error") return <main className="p-6"><ErrorState title="Không kết nối được Hospital" onRetry={retry}>Kiểm tra máy chủ ứng dụng và kết nối Junctura, sau đó thử lại.</ErrorState></main>;
  if (state.kind === "forbidden") return <main className="space-y-4 p-6"><PermissionState title="Bạn chưa có quyền vào Hospital">Liên hệ quản trị viên để kiểm tra tài khoản bác sĩ của bệnh viện.</PermissionState><div className="text-center"><Button onClick={signOut}>Đăng xuất để đổi tài khoản</Button></div></main>;
  if (state.kind === "ready" && config) return <Workspace me={state.me} facility={config.facility} onSignOut={signOut} />;
  if (!signInPage) return <Landing onSignIn={() => setSignInPage(true)} />;
  return <SignInPage product="Hospital" subtitle="Dành cho bác sĩ của bệnh viện" message={state.kind === "signed-out" ? state.message : undefined}
    note="Mật khẩu chỉ nhập trên trang Junctura." onSignIn={signIn} onBack={() => setSignInPage(false)} />;
}

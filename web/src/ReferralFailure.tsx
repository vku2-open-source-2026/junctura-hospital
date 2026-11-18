// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { ErrorState, PermissionState } from "@junctura/health-ui";
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

// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { LandingPage, PreviewFrame, Badge } from "@junctura/health-ui";
import { ClipboardList, ShieldCheck, Stethoscope } from "lucide-react";

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return <LandingPage product="Hospital" badge="Bệnh viện · Bản demo"
    headline="Kết nối thông tin, tiếp nối chăm sóc"
    lead="Không gian làm việc dành cho bác sĩ và nhân viên tiếp nhận trong hệ sinh thái Junctura Health."
    note="Đã có đăng nhập và tra cứu phiếu chuyển tuyến qua Junctura. Các luồng khám, kê đơn và cấp cứu đang được xây dựng; chỉ dùng dữ liệu giả lập."
    onSignIn={onSignIn}
    hero={<PreviewFrame label="Các bước dự kiến của Hospital" title="Hospital · Hướng phát triển">
      <div className="space-y-4"><Badge>Đang xây dựng</Badge>
        <p className="text-lg font-semibold text-ink">Tiếp nhận → Khám → Theo dõi</p>
        <p className="text-sm text-ink-2">Dữ liệu từ trạm y tế được trao đổi qua Junctura theo quyền và đồng thuận.</p>
      </div></PreviewFrame>}
    benefits={{ title: "Hướng tới một ca khám có đủ thông tin", items: [
      { icon: <ClipboardList className="size-5" />, title: "Tiếp nhận có nguồn", text: "Tra cứu phiếu chuyển tuyến, hiển thị nguồn và ngày phát hành của hồ sơ nhận từ trạm." },
      { icon: <Stethoscope className="size-5" />, title: "Thấy rõ trạng thái dị ứng", text: "Phân biệt dữ liệu chưa ghi nhận, không xem được và dị ứng đã xác nhận." },
      { icon: <ShieldCheck className="size-5" />, title: "Trao đổi có kiểm soát", text: "Định danh, đồng thuận và nhật ký trao đổi do Junctura DX-OS cung cấp." },
    ] }}
    steps={{ title: "Kết nối qua nền tảng chung", items: [
      { title: "Đăng nhập Junctura", text: "Mật khẩu chỉ nhập trên trang định danh Junctura." },
      { title: "Kiểm tra quyền Hospital", text: "Máy chủ chỉ cho tài khoản bác sĩ đã được cấu hình vào không gian làm việc." },
      { title: "Phát triển nghiệp vụ từng bước", text: "Tiếp nhận, khám và cấp cứu sẽ được bổ sung theo các Issue riêng." },
    ] }}
    audiences={{ title: "Dành cho đội ngũ bệnh viện", items: [
      { title: "Bác sĩ", text: "Theo dõi người bệnh trong ca khám, biết dữ liệu đến từ đâu." },
      { title: "Nhân viên tiếp nhận", text: "Luồng tiếp nhận và vai trò riêng sẽ được bổ sung ở giai đoạn sau." },
    ] }}
    trust={{ title: "Dùng chung dịch vụ Junctura", items: [
      { title: "Không lưu mật khẩu", text: "Ứng dụng dùng đăng nhập OIDC và PKCE." },
      { title: "Không gọi trực tiếp Clinic", text: "Trao đổi liên ứng dụng sẽ tuân hợp đồng năng lực Health qua Core." },
      { title: "Mã nguồn mở", text: "Apache-2.0; đóng góp qua Issue và Pull Request." },
    ] }}
    faq={{ title: "Trước khi bắt đầu", items: [
      { q: "Bản này đã dùng để khám bệnh chưa?", a: "Chưa. Bản demo có đăng nhập và tra cứu phiếu; chưa xử lý khám bệnh hay xác nhận tiếp nhận." },
      { q: "Ai có thể đăng nhập?", a: "Tài khoản physician thuộc Hospital trong môi trường Health demo đã cấu hình." },
    ] }}
    cta={{ title: "Mở không gian Hospital", lead: "Dùng tài khoản Junctura được cấp cho bệnh viện." }}
    footer={{ links: [{ label: "Mã nguồn", href: "https://github.com/vku2-open-source-2026/junctura-hospital" },
      { label: "Tài liệu Health", href: "https://github.com/vku2-open-source-2026/junctura-health" }] }} />;
}

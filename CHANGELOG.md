<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Changelog

## Unreleased

- Issue #4: tra cứu phiếu referral-summary qua SDK Core với purpose referral_intake.
- Phân biệt thiếu đồng thuận/quyền, lỗi provider/Core, timeout và dữ liệu sai hợp đồng.
- Màn Tiếp nhận dùng Health UI, có nguồn/ngày; xóa kết quả khi đổi ngữ cảnh và bỏ kết quả muộn.
- Thêm kiểm thử adapter/API/UI và kiểm tra local end-to-end có thu hồi consent tạm.


- Khởi tạo Hospital theo Issue #2, tái sử dụng khung Clinic và Health UI.
- Đăng nhập Junctura bằng PKCE, xác minh token và tài khoản physician ở backend.
- Khung bảy khu vực nghiệp vụ; hiện chưa triển khai xử lý hồ sơ.
- Thêm kiểm thử, CI và kiểm tra SPDX/REUSE.
- Dùng Vitest 4.1.12 đã vá; giữ thông báo giấy phép trong bản build.

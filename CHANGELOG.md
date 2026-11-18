<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Changelog

## Unreleased

- Issue #12: truy cập cấp cứu pre-visit-summary/allergy-list qua Core, lý do và xác nhận hai bước bằng Health UI.
- Dải cấp cứu/định danh dính khi cuộn, nguồn/ngày/bốn trạng thái dị ứng; kết thúc/đổi màn bỏ hồ sơ, giới hạn xem 5 phút.
- Chỉ mục yêu cầu gắn bác sĩ với execution trên Core, idempotency và đối chiếu mất phản hồi; lịch sử không trả nội dung y tế.
- Giữ quyền hậu kiểm tại Core, xử lý giới hạn 5 lần chờ; không tự cấp quyền, duyệt hoặc xóa review.
- Ca demo Bình chưa đồng thuận, kiểm thử live chỉ đọc nhật ký dưới danh tính Bình, giữ mục chờ để quản trị viên rà soát.


- Issue #10: kê đơn từ ghi nhận khám, gọi allergy-list với treatment và kiểm tra lại trước phát hành.
- Bốn trạng thái dị ứng, cảnh báo có lý do/xác nhận riêng, bỏ kết quả khi đổi nội dung đơn; không tự điền liều/cách dùng.
- Lưu đơn trên Core với request ID, mã đơn, hạn và bác sĩ; đối chiếu mất phản hồi và danh sách đơn đã kê.
- Provider prescription-verify qua SDK vé một lần của Core, kiểm tra người bệnh/caller/capability và trả đúng hợp đồng tối thiểu.
- Compose provider HTTPS local không mở host port, helper consent giả lập và kiểm thử live từ Pharmacy qua Core.


- Issue #8: mở người bệnh đã được gọi vào khám, xem tóm tắt trước khám qua Core với mục đích điều trị.
- Hiển thị nguồn/ngày và bốn trạng thái dị ứng, nêu dị ứng nặng, đối chiếu định danh hai cơ sở; không thêm giờ cho ngày khám từ trạm.
- Ghi nhận khám do bác sĩ nhập lưu thành từng bản trên Core; nhận diện thao tác gửi lại và đối chiếu khi mất phản hồi.
- Helper demo chuẩn bị/thu hồi riêng quyền điều trị cho An; kiểm thử adapter, API, quyền, lưu ghi nhận và giao diện.


- Issue #6: xác nhận đúng người bệnh, kiểm tra lại quyền xem phiếu và lưu lượt tiếp nhận vào Core.
- Hàng đợi đọc trạng thái BPMN của Core, gọi vào khám, nhận diện lượt đã có và đối chiếu khi mất phản hồi.
- Workflow chỉ nhận khóa không chứa thông tin người bệnh; dữ liệu hàng đợi thuộc collection riêng của Hospital.
- Mẫu demo có/chưa có đồng thuận, helper local chuẩn bị consent và quy trình; hướng dẫn thử từng bước.
- Thêm kiểm thử quyền API, chống tạo trùng, lỗi workflow, trạng thái UI và đối chiếu định danh.


- Issue #4: tra cứu phiếu referral-summary qua SDK Core với purpose referral_intake.
- Phân biệt thiếu đồng thuận/quyền, lỗi provider/Core, timeout và dữ liệu sai hợp đồng.
- Màn Tiếp nhận dùng Health UI, có nguồn/ngày; xóa kết quả khi đổi ngữ cảnh và bỏ kết quả muộn.
- Thêm kiểm thử adapter/API/UI và kiểm tra local end-to-end có thu hồi consent tạm.


- Khởi tạo Hospital theo Issue #2, tái sử dụng khung Clinic và Health UI.
- Đăng nhập Junctura bằng PKCE, xác minh token và tài khoản physician ở backend.
- Khung bảy khu vực nghiệp vụ; hiện chưa triển khai xử lý hồ sơ.
- Thêm kiểm thử, CI và kiểm tra SPDX/REUSE.
- Dùng Vitest 4.1.12 đã vá; giữ thông báo giấy phép trong bản build.

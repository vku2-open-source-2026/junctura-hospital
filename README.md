<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Junctura Hospital

Ứng dụng bệnh viện thuộc [Junctura Health](https://github.com/vku2-open-source-2026/junctura-health), dùng dịch vụ lõi [Junctura DX-OS](https://github.com/vku2-open-source-2026/junctura-dxos).

**Trạng thái:** bản khởi tạo (Issue #2). Có trang giới thiệu, đăng nhập Junctura và khung làm việc cho bác sĩ. Hàng đợi, tiếp nhận, khám, cấp cứu, đơn thuốc, chi phí và nhật ký mới là khu vực điều hướng, chưa xử lý hồ sơ. Chỉ dùng dữ liệu giả lập.

## Yêu cầu

Node.js 24, Git; Docker/Compose để chạy Core. Đặt Hospital cạnh junctura-health và junctura-dxos. Bản sao Clinic chỉ để tham khảo, không cần khi chạy.

## Chuẩn bị Core và Health

Giữ Core đang chạy. Nếu chưa cấu hình Health, trong junctura-health chạy `npm run demo:setup` theo demo/README.md của repo đó. Lệnh tạo ứng dụng `health-hospital`, client web `health-hospital-web` và tài khoản bác sĩ `bacsi.benhvien`.

Hospital tự đọc `../junctura-health/.junctura/demo/junctura-hospital.env`. Mật khẩu demo nằm trong `../junctura-health/.junctura/demo/accounts.env`, không phải tài khoản admin của Core. Không commit hoặc đưa các file này ra frontend.

## Build từ mã nguồn

```powershell
npm ci
npm run web:install
npm run build
npm start
```

Mở **http://localhost:5182** (đúng origin đăng ký PKCE của bộ Health). Đăng nhập qua Junctura. Máy chủ kiểm tra chữ ký, issuer, client, thời hạn token và subject/username được cấp vai trò physician trong danh mục Health.

Để phát triển, dùng hai terminal:

```powershell
npm run dev:server
```

```powershell
npm run dev
```

Vite giữ cổng 5182 và proxy API sang backend 5192. Dừng bằng Ctrl+C.

## Cấu hình

| Biến | Mục đích |
| --- | --- |
| JUNCTURA_HEALTH_DIR | Repo Health; mặc định ../junctura-health |
| JUNCTURA_HOSPITAL_ENV | File env ứng dụng do Health tạo |
| JUNCTURA_ISSUER | Issuer OIDC công khai |
| JUNCTURA_WEB_CLIENT_ID | Client web PKCE; health-hospital-web |
| JUNCTURA_ISSUER_INTERNAL | Tùy chọn địa chỉ lấy JWKS nội bộ; vẫn kiểm tra issuer công khai |
| PORT / WEB_PORT | Cổng HTTP; mặc định 5182 |
| HOST | Địa chỉ lắng nghe; mặc định 127.0.0.1 |
| HOSPITAL_STATIC_DIR | Thư mục build; mặc định web/dist |

Biến môi trường ưu tiên hơn file env của Health. `.env` tại Hospital không tự được nạp: nếu dùng, chạy `node --env-file=.env server/main.mjs`. Tham khảo `.env.example`.

## API hiện có

- GET /health: tiến trình Hospital đang chạy (không phải kiểm tra readiness của Core).
- GET /api/config: chỉ issuer, client web, tên sản phẩm và cơ sở.
- GET /api/me: danh tính bác sĩ đã xác minh; yêu cầu Bearer token.

Chưa có API ghi hồ sơ, gọi năng lực hoặc provider. Chưa thêm database, workflow hay audit riêng.

## Năng lực dự kiến

Hospital sẽ gọi `referral-summary`, `pre-visit-summary`, `allergy-list`, `vaccination-history`; cung cấp `prescription-verify` và `claim-verify`. Hợp đồng lấy từ @junctura/health-contracts; chưa triển khai trong Issue #2. Không gọi thẳng ứng dụng khác.

## Kiểm thử và giấy phép

```powershell
npm run check
npm test
npm run web:test
npm run build
python -m pip install -r requirements-reuse.txt
npm run check:reuse
```

Nếu Python hệ thống chưa có pip, có thể dùng `uv run --no-project --python 3.12 --with-requirements requirements-reuse.txt python -m reuse lint`. Bản build giữ thông báo bản quyền thư viện/font trong `web/dist/notices/`.

Apache-2.0. Khung cấu hình, xác minh token và PKCE tái sử dụng từ Clinic; giao diện dùng @junctura/health-ui. Xem NOTICE, THIRD-PARTY.md và CONTRIBUTING.md.

<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Junctura Hospital

Ứng dụng bệnh viện thuộc [Junctura Health](https://github.com/vku2-open-source-2026/junctura-health), dùng dịch vụ lõi [Junctura DX-OS](https://github.com/vku2-open-source-2026/junctura-dxos).

**Trạng thái:** demo. Đã có đăng nhập Junctura, phân quyền bác sĩ và tra cứu phiếu chuyển tuyến qua Core (Issue #4). Chưa xác nhận tiếp nhận vào hàng đợi/BPMN, khám, kê đơn hoặc xử lý cấp cứu. Chỉ dùng dữ liệu giả lập.

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
- POST /api/referrals/lookup: tra cứu qua Core; body JSON chỉ có `patientSubject` (Keycloak sub dạng UUID) và `referralId`, yêu cầu tài khoản physician. Không gửi mã qua URL.

Chưa có API ghi hồ sơ hoặc provider. Chưa thêm database, workflow hay audit riêng. Core tự kiểm tra đồng thuận và ghi audit trao đổi; Hospital không tự thay thế các cơ chế này.

## Tra cứu chuyển tuyến

Vào **Tiếp nhận**, nhập mã định danh Junctura do người bệnh cung cấp và mã phiếu của Clinic. Hospital dùng SDK để tìm đúng manifest từ Health, gửi `{ referralId }` và context `{ purpose: "referral_intake", dataSubject: patientSubject }`, rồi kiểm tra kết quả trước khi hiển thị. Không gọi thẳng Clinic.

Phiếu không chứa họ tên, năm sinh, giới hoặc dị ứng: giao diện ghi rõ chưa biết/không xem được, không tự lấy thêm dữ liệu từ Clinic. Ngày hiển thị là ngày phát hành, không phải ngày cập nhật hồ sơ. Mọi lần sửa mã hoặc đổi tab đều xóa kết quả đang xem; đóng trình duyệt không lưu phiếu.

Thiếu đồng thuận có thông báo riêng: người bệnh cần cấp quyền cho Hospital, năng lực referral-summary và mục đích referral_intake qua MyHealth/API chủ dữ liệu. Không có đường cấp cứu cho năng lực này. Core hiện gom các HTTP lỗi của provider thành provider_failed, nên Hospital không khẳng định phiếu không tồn tại khi chỉ nhận lỗi này.

### Điều kiện chạy liên thông local

1. Core và Health demo đã được chuẩn bị. Hospital tự đọc `JUNCTURA_URL`, backend client/secret từ env riêng; không đưa secret ra web.
2. ID ứng dụng Clinic lấy từ file demo `junctura-clinic.env` (chỉ dùng JUNCTURA_APP_ID), hoặc đặt `JUNCTURA_REFERRAL_PROVIDER_APP_ID` rõ ràng.
3. Bật C4A bằng cơ chế sẵn có của Core: `npm run provider:pki -- clinic`, cấu hình `C4A_ENABLED=true`, allowlist `https://clinic.provider.internal:8443`, khởi động Core cùng `compose.providers.yaml`. Xem docs/CAPABILITY_EXECUTION.md của Core.
4. Clinic phải cung cấp HTTPS trên origin đó, cùng mạng providers và chứng chỉ đúng CA. Chạy UI Clinic đơn thuần chưa đủ.
5. Người bệnh có đồng thuận còn hiệu lực; grant Hospital → Clinic do Health demo:setup tạo còn hiệu lực.

Chỉ cấu hình local thay đổi; không sửa mã Core hoặc hợp đồng Health. C4B không cần bật. Khi đổi env, khởi động lại Hospital.

### Kiểm thử end-to-end có chủ đích

`npm run test:referrals:live` dùng Core local, tài khoản giả lập An và phiếu CT-2026-000123. Cần chưa có đồng thuận đang hiệu lực của An cho năng lực này. Script dùng helper PKCE của Core, kiểm tra từ chối trước đồng thuận, cấp đồng thuận tạm, lấy phiếu qua provider TLS thật, kiểm tra lỗi phiếu và thu hồi chính đồng thuận vừa tạo trong finally; sau đó xác nhận bị chặn trở lại. Không chạy trên hệ thống thật. Script không khởi động provider hoặc đổi cấu hình Core giúp bạn.

## Năng lực còn lại

Đã gọi `referral-summary`; các năng lực `pre-visit-summary`, `allergy-list`, `vaccination-history`, `prescription-verify` và `claim-verify` để Issue sau. Hợp đồng lấy từ @junctura/health-contracts.

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

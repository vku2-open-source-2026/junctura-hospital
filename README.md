<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Junctura Hospital

Ứng dụng bệnh viện thuộc [Junctura Health](https://github.com/vku2-open-source-2026/junctura-health), dùng dịch vụ lõi [Junctura DX-OS](https://github.com/vku2-open-source-2026/junctura-dxos).

**Trạng thái:** demo. Đã có đăng nhập, phân quyền bác sĩ, tra cứu phiếu chuyển tuyến và xác nhận tiếp nhận vào hàng đợi qua dữ liệu/BPMN của Core (Issue #4, #6). Có gọi vào khám, xem tóm tắt trước khám và lưu ghi nhận khám (Issue #8); chưa có kê đơn, cấp cứu hoặc xác minh chi phí. Chỉ dùng dữ liệu giả lập.

## Yêu cầu

Node.js 24, Git; Docker/Compose để chạy Core. Đặt Hospital cạnh junctura-health và junctura-dxos. Luồng chuyển tuyến cần provider Clinic đang chạy; giao diện Clinic không bắt buộc.

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
- GET /api/config: issuer, client web, tên sản phẩm, cơ sở và cờ demo nếu được bật.
- GET /api/me: danh tính bác sĩ đã xác minh; yêu cầu Bearer token.
- POST /api/referrals/lookup: tra cứu qua Core; body JSON chỉ có `patientSubject` (Keycloak sub dạng UUID) và `referralId`, yêu cầu tài khoản physician. Không gửi mã qua URL.

- GET /api/admissions: hàng đợi từ collection riêng của Hospital trên Core và trạng thái workflow.
- POST /api/admissions: xác nhận tiếp nhận; chỉ nhận `patientSubject`, `referralId`, `patientName`, `birthYear` (số hoặc null), `sex` (male/female/unknown), `identityConfirmed: true`.
- POST /api/admissions/{id}/call: body `{}`, gọi vào khám bằng hoàn tất bước chờ của BPMN.
- GET /api/demo/referrals: mẫu giả lập, chỉ bật trong demo và sau xác thực bác sĩ.

Các API nghiệp vụ yêu cầu Bearer token physician và không nhận định danh qua query. JSON POST giới hạn 4 KiB; riêng API khám giới hạn 16 KiB. Core quản lý lưu dữ liệu, workflow, đồng thuận và audit; Hospital không thêm database hoặc engine riêng.

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

## Tiếp nhận và hàng đợi (Issue #6)

Sau khi xem phiếu, đối chiếu mã người bệnh/phiếu với người đang tiếp nhận, nhập họ tên và năm sinh/giới nếu biết, đánh dấu xác nhận rồi bấm **Xác nhận tiếp nhận**. Hospital tra cứu lại phiếu qua Core để kiểm tra đồng thuận còn hiệu lực và đúng bệnh viện nhận. Tên/giới/năm sinh do bệnh viện đối chiếu, không coi là dữ liệu trả về từ Clinic.

Thông tin tối thiểu lưu trong collection app-private `hospital_admissions_v1` của Core; không sao chép chẩn đoán hoặc xử trí vào hàng đợi. Workflow `junctura_hospital_intake_v1` chỉ nhận một khóa lượt tiếp nhận không chứa định danh/họ tên. Quy trình: bắt đầu → chờ gọi vào khám → kết thúc khi gọi. **Đã gọi vào khám không có nghĩa đã khám xong.** Mức khẩn lấy từ phiếu, không thay thế phân loại lâm sàng.

Trạng thái đọc từ Core mỗi lần làm mới. Không đọc được workflow thì đưa vào mục cần kiểm tra, không tự coi đang chờ. Gửi lại cùng người bệnh/phiếu trả lượt đã có; không tạo một lượt khám mới. Khi mất phản hồi ghi dữ liệu, Hospital đối chiếu lại trước khi thử tiếp. Thao tác gọi cũng có thể gửi lại an toàn.

Phạm vi demo: một tiến trình ghi Hospital, tối đa 100 bản ghi. Chạm giới hạn thì chặn tiếp nhận mới. Core chưa cung cấp transaction chung giữa workflow và data; lỗi giữa hai bước có thể để lại workflow chưa gắn bản ghi, được tái sử dụng bằng cùng khóa khi gửi lại. Chưa cam kết chạy nhiều replica hoặc xử lý đồng thời từ nhiều writer.

### Chuẩn bị quy trình và thử dễ hiểu

Cần các điều kiện liên thông local ở trên, gồm provider Clinic HTTPS. Tại thư mục Hospital:

```powershell
npm run workflow:setup
npm run demo:prepare
npm run build
npm run demo:start
```

Dừng tiến trình Hospital cũ nếu cổng 5182 đang dùng. Mở **http://localhost:5182**, đăng nhập `bacsi.benhvien` bằng mật khẩu trong file Health `accounts.env`.

1. Vào **Tiếp nhận**, chọn **An — thử xem phiếu**, rồi **Tra cứu phiếu**: thấy phiếu thật từ provider giả lập.
2. Đối chiếu thông tin giả lập đã điền, đánh dấu xác nhận → tiếp nhận → xem hàng đợi. Lượt mới có nút **Gọi vào khám**; bấm để chuyển sang **Đã gọi vào khám**.
3. Tải lại trang: trạng thái vẫn còn. Tiếp nhận lại cùng phiếu trả thông báo đã có lượt, không nhân đôi. Nếu An đã được gọi từ lần thử trước, hệ thống giữ trạng thái đó, không tự tạo lượt chờ mới.
4. Chọn mẫu **Đặng Minh Tài — thử thiếu đồng thuận**, tra cứu: thấy **Chưa có đồng thuận**, không thể tiếp nhận. Mẫu được lấy từ Health seed có phiếu thật; không dùng mã bất kỳ.

`workflow:setup` là helper vận hành local: tái sử dụng client khởi tạo bên trong container Core để triển khai XML của Hospital. Chạy lại không tạo phiên bản mới; XML khác với bản đã triển khai sẽ bị chặn, cần khóa quy trình phiên bản mới. App runtime chỉ gọi API công khai của Core và không nhận mật khẩu Flowable.

`demo:prepare` đăng nhập tài khoản bệnh nhân **giả lập** bằng helper PKCE sẵn có, kiểm tra ca thiếu đồng thuận và cấp cho An quyền referral-summary/referral_intake trong 24 giờ (hoặc dùng đồng thuận có sẵn). Nó không thu hồi quyền có sẵn. `npm run demo:clear` chỉ thu hồi đồng thuận do chính helper tạo. Chạy kiểm thử `test:referrals:live` trước `demo:prepare`, hoặc sau khi đã clear và An không còn đồng thuận khác. Không chạy các helper demo trên dữ liệu thật.

`npm start` mặc định không có nút mẫu. `npm run demo:start` hoặc `HOSPITAL_DEMO=true` bật mẫu giả lập; bấm mẫu chỉ điền biểu mẫu, không cấp quyền. SDK client/secret và file trạng thái helper luôn nằm ở backend/thư mục bị gitignore. `JUNCTURA_DXOS_DIR` cho phép chỉ rõ vị trí Core cho các helper vận hành.

## Khám và ghi nhận tại bệnh viện (Issue #8)

Từ **Hàng đợi → Đã gọi vào khám → Mở khám**, hoặc tab **Khám** chọn người bệnh. Backend đọc lại lượt từ Core và chỉ cho mở/lưu khi workflow ở trạng thái đã gọi. Trình duyệt chỉ gửi mã lượt; mã người bệnh dùng để gọi Clinic do server lấy từ bản ghi Hospital, không nhận từ client.

Bấm **Tải tóm tắt trước khám** để gọi `pre-visit-summary` đúng phiên bản/digest Health qua Core, input `{}`, context `{ purpose: "treatment", dataSubject }`. Không tự tải khi mở lượt. Hiển thị tên nguồn, ngày cập nhật, bệnh mạn tính, thuốc đang dùng, tối đa ba lần khám và bốn trạng thái dị ứng; dị ứng nặng được nêu riêng. Ngày khám từ trạm chỉ có ngày thì không tự thêm giờ. Định danh từ trạm khác thông tin Hospital đã đối chiếu sẽ có cảnh báo, không tự thay thế định danh Hospital.

Đồng thuận xem phiếu `referral_intake` **không** thay cho đồng thuận điều trị. Thiếu quyền hiện trạng thái riêng; không biến dữ liệu bị chặn thành “không có dị ứng”. Tải lại xóa snapshot cũ trước khi gọi; đổi người bệnh xóa ngữ cảnh và bỏ phản hồi muộn. Dữ liệu đã nhận là snapshot tại lần tải, không phải cơ chế theo dõi thay đổi đồng thuận nền. Không lưu snapshot Clinic vào Core, localStorage hoặc sessionStorage; dữ liệu hiển thị chỉ ở bộ nhớ màn hình.

**Ghi khám tại bệnh viện** gồm lý do, khám/ghi nhận, mã ICD-10 nếu đã đối chiếu, chẩn đoán/nhận định do bác sĩ nhập và xử trí/kế hoạch. Không tự đề xuất chẩn đoán hay thuốc; chưa có danh mục ICD-10 tra cứu. Bác sĩ xác nhận đã kiểm tra trước khi lưu. Dữ liệu lưu vào Core app-private collection `hospital_exam_notes_v1`, giữ subject/người ghi/thời điểm Core tạo. Mỗi bản đã lưu giữ nguyên; bổ sung bằng bản mới, chưa có chức năng sửa/xóa ghi nhận. Có thể ghi khám tại chỗ khi chưa xem được hồ sơ trạm; đó không phải đường vượt quyền xem dữ liệu trạm.

Lưu dùng request UUID cố định cho một lần thao tác. Mất phản hồi thì giữ nội dung, khóa ô nhập và cho **Kiểm tra kết quả lưu** hoặc thử lại cùng nội dung/mã. Không tự đổi mã để ghi lại. Bản nhập chưa lưu chỉ nằm trong bộ nhớ màn hình và mất khi chuyển màn/tải lại; không có tự lưu nháp. Sau tải lại, kiểm tra lịch sử trước khi nhập lại nếu kết quả lần lưu trước chưa rõ.

Giới hạn demo: một writer Hospital, tối đa 100 ghi nhận cho toàn ứng dụng; chỉ đọc collection trong giới hạn và chặn ghi mới khi đầy. Không cam kết exactly-once giữa nhiều replica hoặc request bị treo ở Core; bản cùng request được đối chiếu/gộp khi đọc. Không có ghi đè bản cũ. Ghi nhận khám chưa đổi hàng đợi thành “đã khám xong”, chưa kết thúc đợt điều trị hoặc kê đơn.

### Thử phần Khám với An

Sau khi Core, provider Clinic và Hospital hoạt động, An đã được tiếp nhận/gọi vào khám:

1. Vào **Khám → Mở khám → Tải tóm tắt trước khám**. Nếu An chỉ có quyền xem phiếu, thấy **Chưa có đồng thuận điều trị**.
2. Trong terminal Hospital chạy `npm run demo:exam:prepare`. Helper dành cho tài khoản **giả lập** cấp quyền `pre-visit-summary`/`treatment` trong 24 giờ (hoặc dùng quyền có sẵn); không sửa đồng thuận phiếu chuyển tuyến.
3. Bấm tải lại tóm tắt: thấy dữ liệu của An và dị ứng Penicillin nặng. Nhập ghi nhận giả lập, đánh dấu xác nhận rồi **Lưu ghi nhận khám**.
4. Đổi tab hoặc tải lại trang, mở lại An: ghi nhận đã lưu vẫn còn cùng tên bác sĩ và thời điểm. Tóm tắt từ trạm cần bấm tải lại.
5. `npm run demo:exam:clear` chỉ thu hồi quyền điều trị do helper này tạo; tải lại tóm tắt bị chặn nếu không có quyền điều trị khác. Không thu hồi quyền có sẵn do người dùng cấp.

API mới (POST JSON, physician):

- `/api/examinations/open` — `{ admissionId }`, trả lượt và ghi nhận thuộc lượt đó.
- `/api/examinations/summary` — `{ admissionId }`, đọc tóm tắt qua Core với mục đích điều trị.
- `/api/examinations/notes` — `{ admissionId, requestId, reason, findings, diagnosis: { code, name }, plan }`, trả 201 khi tạo, 200 khi nhận diện cùng thao tác đã lưu. Server gắn bác sĩ từ token đã xác minh.

## Năng lực còn lại

Đã gọi `referral-summary` và `pre-visit-summary`; các năng lực `allergy-list`, `vaccination-history`, `prescription-verify` và `claim-verify` để Issue sau. Hợp đồng lấy từ @junctura/health-contracts.

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

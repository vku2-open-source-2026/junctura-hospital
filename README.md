<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Junctura Hospital

Ứng dụng bệnh viện thuộc [Junctura Health](https://github.com/vku2-open-source-2026/junctura-health), dùng dịch vụ lõi [Junctura DX-OS](https://github.com/vku2-open-source-2026/junctura-dxos).

**Trạng thái:** demo. Đã có đăng nhập, phân quyền bác sĩ, tra cứu phiếu chuyển tuyến và xác nhận tiếp nhận vào hàng đợi qua dữ liệu/BPMN của Core (Issue #4, #6). Có gọi vào khám, xem tóm tắt trước khám và lưu ghi nhận khám (Issue #8); có kê đơn với kiểm tra dị ứng và provider xác minh đơn (Issue #10); có truy cập dữ liệu cấp cứu có lý do/hậu kiểm Core (Issue #12); chưa có xác minh chi phí. Chỉ dùng dữ liệu giả lập.

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

Các API nghiệp vụ yêu cầu Bearer token physician và không nhận định danh qua query. JSON POST giới hạn 4 KiB; riêng API khám giới hạn 16 KiB, API kê đơn 32 KiB. Core quản lý lưu dữ liệu, workflow, đồng thuận và audit; Hospital không thêm database hoặc engine riêng.

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

## Kê đơn và xác minh đơn (Issue #10)

Lưu ghi nhận khám trước, rồi chọn **Kê đơn từ ghi nhận này**. Chọn thuốc/hàm lượng từ danh mục chung `HOSPITAL_DRUGS` của Health; tự nhập số lượng và cách dùng, không tự điền liều. Tối đa 20 thuốc không trùng, số lượng 1–1000 theo hợp đồng. Thời hạn đơn trong demo chọn 1–30 ngày; đây là giới hạn sản phẩm demo, không phải quy định về đơn thuốc.

Bấm **Kiểm tra dị ứng và xem lại đơn**: Hospital gọi `allergy-list` qua Core với input `{}` và `purpose: treatment`, dataSubject lấy từ lượt Hospital. Đồng thuận cho `pre-visit-summary` chưa bao gồm `allergy-list`. Thiếu đồng thuận hoặc lỗi nguồn thì không phát hành; không có đường bỏ qua quyền bằng lý do. Dữ liệu chưa ghi nhận hoặc cũ hơn 365 ngày cần bác sĩ rà soát và ghi lý do. Kết quả có nguồn/ngày và giữ đúng bốn trạng thái dị ứng.

Quy tắc demo chỉ so tên thuốc/chất dị ứng và ánh xạ **Penicillin → Amoxicillin**, tham khảo [NHS về Amoxicillin](https://www.nhs.uk/medicines/amoxicillin/who-can-and-cannot-take-amoxicillin/). Đây không phải cơ sở dữ liệu tương tác, tá dược, thương hiệu hoặc toàn bộ phản ứng chéo; không suy ra một thuốc an toàn vì chưa phát hiện khớp. Không chẩn đoán, gợi ý thuốc hoặc tính liều. Khi có xung đột, giao diện hiển thị cảnh báo chặn; để tiếp tục trong demo bác sĩ phải nhập lý do tối thiểu 10 ký tự và xác nhận riêng. Quy tắc chưa được thẩm định lâm sàng; chỉ dùng dữ liệu giả lập.

Đổi thuốc/số lượng/cách dùng/hạn hoặc ghi nhận làm căn cứ sẽ bỏ kết quả kiểm tra cũ. Sau khi xem lại, đánh dấu đã rà soát rồi **Phát hành đơn thuốc**. Backend kiểm tra lại quyền và dị ứng tại thời điểm phát hành, gắn bác sĩ từ token đã xác minh, giữ lý do/các cảnh báo trong bản ghi. Nếu dữ liệu thay đổi, server có thể yêu cầu rà soát lại dù bước xem trước đã qua.

Đơn lưu trong Core app-private collection `hospital_prescriptions_v1`; mã `DT-…` ổn định theo request UUID, có thời điểm lập/hết hạn và căn cứ ghi nhận khám. Bấm lặp cùng thao tác không tạo đơn mới. Mất phản hồi giữ nguyên nội dung/mã, có nút kiểm tra kết quả phát hành hoặc thử lại cùng thao tác. Bản nhập chưa phát hành ở bộ nhớ màn hình; nếu tải lại khi chưa rõ kết quả, kiểm tra danh sách đơn trước khi nhập lại.

Tab **Đơn thuốc** hiển thị đơn đã lưu và hết hạn. Chưa có sửa/hủy, in/QR hoặc đồng bộ phát thuốc. `dispensed` khởi tạo false; nhãn **Chưa ghi nhận phát thuốc** không xác nhận thực tế nhà thuốc chưa phát. Hợp đồng `prescription-verify` chỉ đọc, chưa có hợp đồng gửi kết quả phát thuốc về Hospital. Giới hạn một writer/100 bản ghi như các module demo khác; không cam kết exactly-once nhiều replica. Khi chạm giới hạn, dừng tạo/xác minh để không trả sai vì dữ liệu nằm ngoài trang đầu.

### Thử kê đơn

1. An đã có lượt gọi vào khám và ghi nhận đã lưu. Chạy `npm run demo:rx:prepare` để chuẩn bị riêng quyền allergy-list/treatment 24 giờ cho An giả lập.
2. Khám → mở An → **Kê đơn từ ghi nhận này**. Chọn Amoxicillin và nhập nội dung kiểm thử, bấm kiểm tra: thấy cảnh báo Penicillin nặng, nút phát hành vẫn khóa nếu thiếu lý do/xác nhận.
3. Có thể đổi thuốc trong danh mục để kiểm tra việc bỏ kết quả cũ; đây chỉ là thao tác thử phần mềm, không phải gợi ý thay thuốc. Nhập lại kiểm tra, xem lại rồi phát hành đơn giả lập.
4. Tải lại trang, mở Đơn thuốc: mã và nội dung vẫn còn. `npm run demo:rx:clear` chỉ thu hồi quyền do helper này tạo; không ảnh hưởng quyền tóm tắt hoặc phiếu chuyển tuyến.

### Provider xác minh cho Pharmacy

Runtime provider bật bằng `PROVIDER_TLS_CERT`, `PROVIDER_TLS_KEY`, `PROVIDER_PORT` (8443) và `PROVIDER_BIND` (mặc định loopback). Đọc `JUNCTURA_PHARMACY_APP_ID` hoặc app ID từ env Pharmacy do Health tạo, không đưa credential Pharmacy vào Hospital runtime. Có chế độ chỉ chạy provider: `node server/provider-main.mjs`.

Provider nhận `POST /capabilities/prescription-verify`. Dùng SDK `redeemTicket` của Core cho vé một lần và input digest, sau đó đối chiếu capability/version/digest, ứng dụng provider/caller, invocation và context `dispensing`. Không chấp nhận quyền xem phiếu/tóm tắt hoặc cấp cứu. Chỉ đọc đơn của đúng dataSubject trong vé. Trả đúng `{ output: { valid, issuedAt, expiresAt, items, dispensed } }`; không có tên, chẩn đoán hay ghi khám. Đơn sai người/không tồn tại trả valid=false, items rỗng và mốc ngày placeholder 1970 bắt buộc theo schema; đơn hết hạn không trả danh sách thuốc. Chưa có chức năng đánh dấu phát thuốc.

Để chạy provider local trong mạng Compose của Core, chuẩn bị tại repo DX-OS:

```powershell
npm run provider:pki -- clinic hospital
# Giữ origin Clinic và bổ sung Hospital trong .env:
# C4A_INTERNAL_PROVIDER_ORIGINS=["https://clinic.provider.internal:8443","https://hospital.provider.internal:8443"]
docker compose -f compose.yaml -f compose.providers.yaml up -d core
```

Tại Hospital:

```powershell
npm run demo:provider:up
npm run demo:pharmacy:prepare
npm run test:prescriptions:live
```

Helper Pharmacy chỉ cấp đồng thuận giả lập `prescription-verify/dispensing` cho An trong 24 giờ; `demo:pharmacy:clear` chỉ thu hồi quyền do helper đó tạo. Kiểm thử live cần đã có đơn An chưa hết hạn, không tự kê thêm đơn. Nó dùng client Pharmacy → Core → provider TLS, xác minh đơn có thật và mã không tồn tại, kiểm tra đúng trường hợp đồng. Core vẫn xử lý grant, đồng thuận và audit.

Compose provider local không mở host port, dùng CA riêng có kiểm tra hostname, tách mạng provider/edge, mount mã/node_modules/seed công khai và đúng key Hospital ở chế độ chỉ đọc. Loopback bridge chỉ phục vụ SDK tới Gateway trong mạng demo; không phải cấu hình triển khai production. Core phải có image `junctura-core:local` và mạng edge/providers. Có thể đặt `JUNCTURA_DXOS_DIR`, `JUNCTURA_EDGE_NETWORK`, `JUNCTURA_PROVIDERS_NETWORK` khi khác mặc định. `npm run demo:provider:down` chỉ dừng container provider này, không xóa dữ liệu Core.

API physician mới:

- GET `/api/prescriptions`: danh sách đơn của Hospital.
- POST `/api/prescriptions/open`: `{ admissionId }`, căn cứ khám, danh mục và đơn của lượt.
- POST `/api/prescriptions/check`: `{ admissionId, noteId, items, validDays }`, kiểm tra dị ứng hiện tại.
- POST `/api/prescriptions/issue`: như check, thêm `{ requestId, reviewConfirmed: true, overrideReason }`. Trả 201 khi tạo, 200 khi nhận diện cùng thao tác đã lưu.

## Truy cập dữ liệu cấp cứu (Issue #12)

Tab **Cấp cứu** dành cho bác sĩ Hospital đã xác thực; có thể mở từ màn Khám khi thiếu đồng thuận điều trị. Không cần lượt tiếp nhận hoặc phiếu chuyển tuyến: ca mẫu Bình chưa có phiếu vẫn dùng được. Đây là luồng truy cập dữ liệu khi cấp cứu, chưa phải chức năng quản lý điều trị cấp cứu, phân loại hay vận chuyển người bệnh.

1. Nhập mã người bệnh và chọn **Tóm tắt trước khám** hoặc **Danh sách dị ứng**. Đối chiếu đúng người bệnh và đánh dấu xác nhận.
2. **Nhập lý do truy cập cấp cứu**: hộp thoại Health UI gồm bước nhập lý do và bước xác nhận lại người bệnh/dữ liệu/lý do. Hủy ở một trong hai bước không tạo tác vụ Core.
3. Hospital gọi đúng manifest/version/digest của Clinic qua SDK, input `{}`, context `{ purpose: "treatment", dataSubject, emergency: true, justification }`. Lý do 10–500 ký tự, không có ký tự điều khiển. Core cho bỏ kiểm tra đồng thuận trong trường hợp này, vẫn giữ grant/quyền ứng dụng, vé provider, nhật ký và hậu kiểm.
4. Khi chờ/xem kết quả có dải **Đang truy cập khẩn cấp** kèm lý do và nút kết thúc, giữ cùng thanh định danh khi cuộn. Dữ liệu có nguồn/ngày và bốn trạng thái dị ứng. Riêng allergy-list không cung cấp định danh nên không tự điền họ tên/năm sinh/giới.
5. **Kết thúc truy cập khẩn cấp** xóa hồ sơ khỏi màn xem và đóng yêu cầu tại Hospital; đổi tab/tải lại cũng bỏ nội dung trong bộ nhớ màn hình. Không xóa sự kiện Core, không thu hồi dữ liệu đã tải, không tự duyệt hậu kiểm. Màn xem tự đóng sau tối đa khoảng 5 phút; backend cũng chặn sử dụng lại yêu cầu quá 5 phút hoặc đã đóng. Không lưu bản sao hồ sơ vào app-private collection, localStorage hoặc sessionStorage.

Chỉ hai năng lực trên được phép. Không dùng cấp cứu để mở `referral-summary`, `prescription-verify`, chi phí hoặc bỏ qua quyền kê đơn. Mỗi lần xác nhận chỉ gọi một năng lực, không âm thầm tạo hai tác vụ cấp cứu. Luồng kê đơn và đọc thông thường tiếp tục yêu cầu đồng thuận như trước.

### Liên kết yêu cầu và lịch sử

Hospital lưu **chỉ mục yêu cầu** trong Core app-private `hospital_emergency_requests_v1`: mã thao tác, mã người bệnh, năng lực, lý do, bác sĩ đã xác minh, thời điểm và mã execution. Không chứa kết quả y tế. Đây là metadata nghiệp vụ để nối lượt yêu cầu của bác sĩ với tác vụ Core; không thay thế nhật ký bảo vệ của Core và không có thuật toán audit/consent/review riêng.

Chỉ mục được ghi trước khi gửi; server liên kết execution ngay sau khi Core nhận. Nếu mất phản hồi, thử lại giữ cùng mã idempotency, người bệnh, lý do và bác sĩ để đối chiếu. Không tự tạo mã mới khi kết quả chưa rõ. Một yêu cầu chưa liên kết không được coi là đã truy cập thành công; Core có thể đã nhận nhưng chưa trả mã về. Yêu cầu hết thời hạn cần xác nhận lại bằng mã mới nếu vẫn có lý do cấp cứu. Giới hạn demo một writer/100 bản ghi; chưa cam kết exactly-once nhiều replica hoặc khôi phục chỉ mục bị xóa ngoài ứng dụng.

**Yêu cầu cấp cứu của Hospital** đọc metadata từ Core Data và trạng thái execution từ Core; không trả nội dung hồ sơ trong lịch sử. API kết quả hậu kiểm `/v1/emergency-accesses` yêu cầu `trust.approve`: với client Hospital thông thường, UI ghi rõ chỉ quản trị viên xem được kết quả, không suy diễn là đã duyệt/chờ duyệt. Nếu client đã có quyền đọc hợp lệ, chỉ hiện kết quả của những mã execution của Hospital trong chỉ mục. App không cấp thêm quyền quản trị và không cung cấp route duyệt.

Core chặn khi có **5 lần truy cập chưa hậu kiểm cho cùng ứng dụng** (`429 emergency_review_backlog`), kể cả có nhiều bác sĩ. Khi chạm giới hạn, liên hệ quản trị viên DX-OS. Đóng màn xem không làm giảm số chờ hậu kiểm. Quản trị viên thực hiện qua API sẵn có:

- GET `/v1/emergency-accesses`
- POST `/v1/emergency-accesses/{executionId}/review`, `{ decision: "justified" | "unjustified", note }`

Hospital không gọi API ghi quyết định này. Người bệnh xem lần truy cập và trạng thái hậu kiểm qua `/v1/me/data-access` bằng chính tài khoản của mình.

### Thử với Bình giả lập

Core và provider Clinic phải hoạt động; chạy Hospital bằng `npm run demo:start`. Trong **Cấp cứu**, bấm **Bình — thử truy cập cấp cứu**, đối chiếu mã, nhập lý do rõ đây là kiểm thử dữ liệu giả, xác nhận hai bước. Xem kết quả và kết thúc. Nút mẫu chỉ điền mã, không cấp đồng thuận. Không chạy nhiều lần liên tiếp để tránh làm đầy hàng hậu kiểm.

`npm run test:emergency:live` kiểm chứng **yêu cầu Bình đã có** (có thể thêm executionId làm đối số). Script chỉ đọc: dùng client Hospital đọc metadata/trạng thái, đăng nhập Bình giả lập bằng helper PKCE của Core, kiểm tra không có đồng thuận tương ứng và kiểm tra nhật ký của chính Bình có `emergency=true`, `purpose=treatment` cùng trạng thái hậu kiểm. Nó không tạo thêm lần cấp cứu, không thu hồi consent và không duyệt/xóa mục chờ. Lần QA của module được giữ lại để quản trị viên kiểm tra.

API mới (physician, không nhận định danh qua query, JSON POST tối đa 4 KiB):

- GET `/api/emergency/demo`: mã mẫu chỉ trong chế độ demo, sau xác thực.
- GET `/api/emergency/history`: chỉ mục yêu cầu và trạng thái đối chiếu Core.
- POST `/api/emergency/access`: `{ operationId, patientSubject, capability, justification, identityConfirmed: true, confirmed: true }`; capability chỉ pre-visit-summary/allergy-list.
- POST `/api/emergency/end`: `{ operationId }`; chỉ bác sĩ sở hữu yêu cầu được đóng. Không hủy execution hoặc quyết định hậu kiểm Core.

## Năng lực còn lại

Đã gọi `referral-summary` và `pre-visit-summary`; đã thêm `allergy-list` và provider `prescription-verify`; `vaccination-history` và `claim-verify` để Issue sau. Hợp đồng lấy từ @junctura/health-contracts.

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

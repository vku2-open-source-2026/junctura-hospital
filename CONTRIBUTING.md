<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Đóng góp

1. Mỗi việc có Issue trước; nhánh `feat/<việc>` hoặc `fix/<việc>` từ nhánh nền mới nhất.
2. Dùng lại Junctura DX-OS, hợp đồng và giao diện của Junctura Health; tham khảo Clinic.
3. Commit theo Conventional Commits; không push trực tiếp nhánh nền.
4. Chạy `npm run check`, `npm test`, `npm run web:test`, `npm run build`, `npm run check:reuse`.
5. Mở PR, title tiếng Anh, mô tả tiếng Việt, `Closes #<Issue>`; cần CI xanh và người khác duyệt.
6. Mọi file có SPDX Apache-2.0; file không hỗ trợ comment khai trong REUSE.toml.
7. Không commit secret, node_modules hay dữ liệu thật; cập nhật CHANGELOG.

Chuẩn giao diện: https://github.com/vku2-open-source-2026/junctura-health/blob/main/docs/DESIGN.md

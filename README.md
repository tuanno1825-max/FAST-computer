# FAST Computer — Hệ thống Quản lý Bán hàng Linh kiện PC & Kế toán SME

Ứng dụng web quản lý bán hàng, kho vận và kế toán cho cửa hàng linh kiện máy tính **FAST Computer**, xây dựng bằng **Node.js (Express)**, **PostgreSQL (Neon)** và **HTML/CSS/JavaScript**.

## Tính năng chính
- **Trang bán hàng Online (`/`):** Duyệt danh mục linh kiện, tìm kiếm tức thì, xem chi tiết thông số & bảo hành, giỏ hàng (`localStorage`), đặt hàng COD hoặc chuyển khoản kèm mã VietQR (`ChoThanhToan`).
- **Trang Quản trị & Kế toán (`/admin`):**
  - **Phân quyền RBAC 4 vai trò:** `Admin`, `KeToan`, `BanHang`, `ThuKho`.
  - **Mua hàng & Nhập kho 2 bước:** Lập phiếu nhập `ChoNhapKho` → Thủ kho kiểm đếm & chọn ô kệ xếp hàng (`DaNhapKho`), quản lý Serial/IMEI & công nợ NCC (TK 331).
  - **Bán hàng & Đổi/Trả hàng 3 bước (RMA):** Xuất hóa đơn `HD-...`, chọn Serial xuất kho, kiểm soát hạn mức công nợ (TK 131), thu tiền đơn online/công nợ (`PT-...`), quy trình trả hàng qua Thủ kho kiểm nhận & Kế toán hoàn tiền (`PC-...`).
  - **Kho & Sơ đồ Mặt bằng 2D:** Bản đồ kho 4 Dãy × 4 Kệ × 4 Ô (64 ô) tương tác, tìm nhanh định vị ô kệ, chuyển kệ, kiểm kê & cân bằng kho (`KK-...`), Thẻ kho chi tiết.
  - **Thu - Chi, Bảo hành & Báo cáo:** Sổ quỹ Thu - Chi, tra cứu bảo hành theo Serial, biểu đồ thống kê doanh thu/lãi gộp/tồn kho/công nợ.

## Cài đặt & Chạy Local
1. Cài đặt thư viện:
   ```bash
   npm install
   ```
2. Tạo file `.env` từ `.env.example` và điền `DATABASE_URL` (Neon PostgreSQL) cùng `SESSION_SECRET`:
   ```bash
   cp .env.example .env
   ```
3. Khởi tạo cấu trúc 12 bảng & dữ liệu mẫu lên PostgreSQL:
   ```bash
   npm run init-db
   ```
4. Chạy server:
   ```bash
   npm start
   ```
   - Trang khách hàng: `http://localhost:3000/`
   - Trang quản trị: `http://localhost:3000/admin`

## Triển khai lên Render
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment Variables:** `DATABASE_URL`, `SESSION_SECRET`

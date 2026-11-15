-- ============================================================================
-- HỆ THỐNG QUẢN LÝ CỬA HÀNG LINH KIỆN MÁY TÍNH & KẾ TOÁN FAST COMPUTER (SME)
-- Script khởi tạo Cơ sở dữ liệu chuẩn PostgreSQL (12 bảng - Chuẩn 3NF)
-- Đáp ứng yêu cầu Trình 2: Khóa chính, Khóa ngoại, Ràng buộc CHECK/UNIQUE/NOT NULL
-- ============================================================================

-- Xóa bảng cũ nếu chạy lại từ đầu (theo thứ tự phụ thuộc khóa ngoại)
DROP TABLE IF EXISTS stock_adjustments CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoice_details CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS purchase_details CASCADE;
DROP TABLE IF EXISTS purchase_receipts CASCADE;
DROP TABLE IF EXISTS warranty_serials CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Bảng Người dùng / Nhân viên & Phân quyền (Users)
CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    username      VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(100) NOT NULL,
    role          VARCHAR(20) NOT NULL CHECK (role IN ('Admin', 'KeToan', 'BanHang', 'ThuKho')),
    phone         VARCHAR(20),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login    TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng Loại linh kiện (Categories)
CREATE TABLE categories (
    category_id   SERIAL PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    description   TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng Nhà cung cấp (Suppliers)
CREATE TABLE suppliers (
    supplier_id     SERIAL PRIMARY KEY,
    supplier_name   VARCHAR(150) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    tax_code        VARCHAR(30) UNIQUE,
    address         VARCHAR(255),
    sale_contact    VARCHAR(150),
    rma_address     VARCHAR(255),
    bank_account    VARCHAR(150),
    payable_balance NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (payable_balance >= 0),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bảng Khách hàng (Customers)
CREATE TABLE customers (
    customer_id    SERIAL PRIMARY KEY,
    customer_name  VARCHAR(150) NOT NULL,
    phone          VARCHAR(20) NOT NULL UNIQUE,
    tax_code       VARCHAR(30),
    email          VARCHAR(120),
    customer_group VARCHAR(30) NOT NULL DEFAULT 'KhachLe' CHECK (customer_group IN ('KhachLe', 'PhongNet', 'DoanhNghiep')),
    address        VARCHAR(255),
    credit_limit   NUMERIC(15, 2) NOT NULL DEFAULT 10000000 CHECK (credit_limit >= 0),
    debt_amount    NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (debt_amount >= 0),
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bảng Sản phẩm / Linh kiện (Products) - Kiểm soát tồn kho >= 0
CREATE TABLE products (
    product_id      SERIAL PRIMARY KEY,
    sku             VARCHAR(50) NOT NULL UNIQUE,
    product_name    VARCHAR(200) NOT NULL,
    category_id     INT NOT NULL,
    brand           VARCHAR(80),
    unit            VARCHAR(30) NOT NULL DEFAULT 'Cái',
    import_price    NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (import_price >= 0),
    sale_price      NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    stock_qty       INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    min_stock       INT NOT NULL DEFAULT 5 CHECK (min_stock >= 0),
    warranty_months INT NOT NULL DEFAULT 12 CHECK (warranty_months >= 0),
    shelf_location  VARCHAR(50),
    image_url       TEXT,
    specs           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 6. Bảng Serial Bảo hành (WarrantySerials)
CREATE TABLE warranty_serials (
    serial_id     SERIAL PRIMARY KEY,
    product_id    INT NOT NULL,
    receipt_id    INT,
    invoice_id    INT,
    serial_number VARCHAR(100) NOT NULL UNIQUE,
    status        VARCHAR(20) NOT NULL DEFAULT 'TrongKho' CHECK (status IN ('TrongKho', 'DaBan', 'BaoHanh')),
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_serials_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 7. Bảng Phiếu nhập hàng (PurchaseReceipts)
CREATE TABLE purchase_receipts (
    receipt_id          SERIAL PRIMARY KEY,
    receipt_no          VARCHAR(30) NOT NULL UNIQUE,
    supplier_invoice_no VARCHAR(50),
    supplier_id         INT NOT NULL,
    user_id             INT NOT NULL,
    receipt_date        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount        NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount         NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    warehouse_status    VARCHAR(20) NOT NULL DEFAULT 'DaNhapKho' CHECK (warehouse_status IN ('ChoNhapKho', 'DaNhapKho')),
    notes               TEXT,
    CONSTRAINT fk_receipts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 8. Bảng Chi tiết phiếu nhập (PurchaseDetails)
CREATE TABLE purchase_details (
    pur_detail_id SERIAL PRIMARY KEY,
    receipt_id    INT NOT NULL,
    product_id    INT NOT NULL,
    quantity      INT NOT NULL CHECK (quantity > 0),
    import_price  NUMERIC(15, 2) NOT NULL CHECK (import_price >= 0),
    line_total    NUMERIC(15, 2) NOT NULL CHECK (line_total >= 0),
    CONSTRAINT fk_pur_details_receipt FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(receipt_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_pur_details_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 9. Bảng Hóa đơn bán hàng (Invoices)
CREATE TABLE invoices (
    invoice_id     SERIAL PRIMARY KEY,
    invoice_no     VARCHAR(30) NOT NULL UNIQUE,
    customer_id    INT NOT NULL,
    user_id        INT NOT NULL,
    invoice_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subtotal       NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    vat_amount     NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    total_amount   NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount    NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    debt_amount    NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (debt_amount >= 0),
    payment_method VARCHAR(30) NOT NULL DEFAULT 'TienMat' CHECK (payment_method IN ('TienMat', 'ChuyenKhoan', 'QuetThe', 'CongNo')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'DaThanhToan' CHECK (payment_status IN ('DaThanhToan', 'ThanhToanMotPhan', 'GhiNo', 'ChoThanhToan', 'ChoTraHang', 'DaHuy', 'DaDoiTra')),
    notes          TEXT,
    CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 10. Bảng Chi tiết hóa đơn (InvoiceDetails)
CREATE TABLE invoice_details (
    detail_id   SERIAL PRIMARY KEY,
    invoice_id  INT NOT NULL,
    product_id  INT NOT NULL,
    quantity    INT NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(15, 2) NOT NULL CHECK (unit_price >= 0),
    line_total  NUMERIC(15, 2) NOT NULL CHECK (line_total >= 0),
    CONSTRAINT fk_inv_details_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_inv_details_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 11. Bảng Thu / Chi & Thanh toán công nợ (Payments)
CREATE TABLE payments (
    payment_id     SERIAL PRIMARY KEY,
    payment_no     VARCHAR(30) NOT NULL UNIQUE,
    payment_type   VARCHAR(10) NOT NULL CHECK (payment_type IN ('Thu', 'Chi')),
    invoice_id     INT,
    receipt_id     INT,
    user_id        INT NOT NULL,
    amount         NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(30) NOT NULL DEFAULT 'TienMat' CHECK (payment_method IN ('TienMat', 'ChuyenKhoan', 'QuetThe')),
    payment_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes          TEXT,
    CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_payments_receipt FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(receipt_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 12. Bảng Kiểm kho & Điều chỉnh tồn kho (StockAdjustments)
CREATE TABLE stock_adjustments (
    adjustment_id SERIAL PRIMARY KEY,
    adjustment_no VARCHAR(30) NOT NULL UNIQUE,
    product_id    INT NOT NULL,
    user_id       INT NOT NULL,
    system_qty    INT NOT NULL CHECK (system_qty >= 0),
    actual_qty    INT NOT NULL CHECK (actual_qty >= 0),
    diff_qty      INT NOT NULL,
    reason        TEXT,
    adjusted_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_adjustments_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_adjustments_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ============================================================================
-- DỮ LIỆU MẪU KHỞI TẠO (5 thành viên nhóm - Mật khẩu mặc định: 123456)
-- ============================================================================

INSERT INTO users (username, password_hash, full_name, role, phone) VALUES
('ducduong_admin', '$2a$10$LQVqc2MW5n9wRLzLtHFpiOwqam3Sg0LZH18prxn6Xtku5rM7x8FoW', 'Nguyễn Đức Dương', 'Admin', '0901234567'),
('ketoan_linh', '$2a$10$LQVqc2MW5n9wRLzLtHFpiOwqam3Sg0LZH18prxn6Xtku5rM7x8FoW', 'Phạm Khánh Linh', 'KeToan', '0902345678'),
('thukho_tuan', '$2a$10$LQVqc2MW5n9wRLzLtHFpiOwqam3Sg0LZH18prxn6Xtku5rM7x8FoW', 'Phạm Anh Tuấn', 'ThuKho', '0903456789'),
('banhang_trung', '$2a$10$LQVqc2MW5n9wRLzLtHFpiOwqam3Sg0LZH18prxn6Xtku5rM7x8FoW', 'Nguyễn Thanh Sơn Trung', 'BanHang', '0904567890'),
('ketoan_binh', '$2a$10$LQVqc2MW5n9wRLzLtHFpiOwqam3Sg0LZH18prxn6Xtku5rM7x8FoW', 'Phạm Thanh Bình', 'KeToan', '0905678901');

INSERT INTO categories (category_name, description) VALUES
('CPU - Vi xử lý', 'Bộ vi xử lý Intel Core & AMD Ryzen'),
('VGA - Card màn hình', 'Card đồ họa NVIDIA GeForce & AMD Radeon'),
('RAM - Bộ nhớ trong', 'Thanh nhớ DDR4, DDR5 cho PC'),
('Ổ cứng SSD & HDD', 'Ổ cứng thể rắn NVMe M.2, SATA III & HDD lưu trữ'),
('Mainboard - Bo mạch chủ', 'Bo mạch chủ chipset Intel & AMD'),
('PSU - Nguồn máy tính', 'Bộ nguồn công suất thực chuẩn 80 Plus'),
('Case & Tản nhiệt', 'Vỏ máy tính và tản nhiệt khí / nước AIO'),
('Monitor - Màn hình', 'Màn hình Gaming 144Hz-240Hz, văn phòng & đồ họa'),
('Gaming Gear - Ngoại vi', 'Chuột Gaming, bàn phím cơ, tai nghe, lót chuột'),
('Phụ kiện & Thiết bị mạng', 'Arm màn hình, dây cáp HDMI/DP, keo tản nhiệt, card Wi-Fi');

INSERT INTO suppliers (supplier_name, phone, tax_code, address, sale_contact, rma_address, bank_account, payable_balance) VALUES
('Công ty CP Phân phối Viễn Sơn', '02838326085', '0301456789', 'Quận 1, TP. Hồ Chí Minh', 'Anh Dũng - 0908111222', '162B Bùi Thị Xuân, Q.1, TP.HCM', '19033445566 - Techcombank CN HCM', 15000000),
('Công ty TNHH Thủy Linh (TLC)', '02435371525', '0101234567', 'Đống Đa, Hà Nội', 'Chị Hương - 0913444555', '33 Thái Hà, Đống Đa, Hà Nội', '001100223344 - Vietcombank Sở Giao Dịch', 0),
('Nhà phân phối Synnex FPT', '02473008888', '0102345678', 'Cầu Giấy, Hà Nội', 'Anh Minh - 0987654321', 'Số 10 Phạm Văn Bạch, Cầu Giấy, Hà Nội', '112233445566 - ACB CN Hà Nội', 8500000);

INSERT INTO customers (customer_name, phone, tax_code, email, customer_group, address, credit_limit, debt_amount) VALUES
('Khách lẻ tại quầy', '0000000000', NULL, NULL, 'KhachLe', 'Showroom FAST Computer', 0, 0),
('Công ty TNHH Thiết kế Kiến An', '0912888999', '0109988776', 'ketoan@kienan.vn', 'DoanhNghiep', 'Thanh Xuân, Hà Nội', 20000000, 4500000),
('Anh Hoàng Tuấn Anh', '0988777666', NULL, 'tuananh.net@gmail.com', 'PhongNet', 'Hai Bà Trưng, Hà Nội', 15000000, 0),
('Chị Nguyễn Thu Hà', '0977555444', NULL, 'thuha@gmail.com', 'KhachLe', 'Hoàn Kiếm, Hà Nội', 5000000, 1200000);

INSERT INTO products (sku, product_name, category_id, brand, unit, import_price, sale_price, stock_qty, min_stock, warranty_months, shelf_location, image_url, specs) VALUES
('CPU-I5-13400F', 'CPU Intel Core i5-13400F (10 nhân 16 luồng)', 1, 'Intel', 'Cái', 4200000, 4890000, 14, 5, 36, 'Dãy A - Kệ 1 - Ô 03', '/images/products/CPU-I5-13400F.png', 'Socket LGA1700 | 10 Nhân 16 Luồng | Boost 4.6GHz'),
('CPU-R5-7600', 'CPU AMD Ryzen 5 7600 (AM5)', 1, 'AMD', 'Cái', 4600000, 5290000, 3, 5, 36, 'Dãy A - Kệ 2 - Ô 01', '/images/products/CPU-R5-7600.png', 'Socket AM5 | 6 Nhân 12 Luồng | Boost 5.1GHz'),
('CPU-I5-12400F', 'CPU Intel Core i5-12400F (6 nhân 12 luồng)', 1, 'Intel', 'Cái', 2650000, 3190000, 10, 4, 36, 'Dãy A - Kệ 1 - Ô 02', '/images/products/CPU-I5-12400F.png', 'Socket LGA1700 | 6 Nhân 12 Luồng | Boost 4.4GHz'),
('CPU-I7-14700K', 'CPU Intel Core i7-14700K (20 nhân 28 luồng)', 1, 'Intel', 'Cái', 9200000, 10490000, 5, 2, 36, 'Dãy A - Kệ 1 - Ô 04', '/images/products/CPU-I7-14700K.png', 'Socket LGA1700 | 20 Nhân 28 Luồng | Boost 5.6GHz'),
('VGA-RTX4060', 'VGA ASUS Dual GeForce RTX 4060 OC 8GB', 2, 'ASUS', 'Cái', 7200000, 8290000, 8, 4, 36, 'Dãy B - Kệ 1 - Ô 03', '/images/products/VGA-RTX4060.png', '8GB GDDR6 | 128-bit | PCIe 4.0 | 2 Quạt'),
('VGA-RTX3060', 'VGA MSI GeForce RTX 3060 Ventus 2X 12GB', 2, 'MSI', 'Cái', 6100000, 6990000, 2, 4, 36, 'Dãy B - Kệ 1 - Ô 02', '/images/products/VGA-RTX3060.png', '12GB GDDR6 | 192-bit | PCIe 4.0 | 2 Quạt'),
('VGA-RX6600', 'VGA Sapphire Pulse AMD Radeon RX 6600 8GB', 2, 'AMD', 'Cái', 4800000, 5590000, 6, 3, 36, 'Dãy B - Kệ 2 - Ô 01', '/images/products/VGA-RX6600.png', '8GB GDDR6 | 128-bit | PCIe 4.0 | Tối ưu 1080p'),
('VGA-RTX4070S', 'VGA Gigabyte GeForce RTX 4070 SUPER Gaming OC 12GB', 2, 'Gigabyte', 'Cái', 15800000, 17690000, 3, 4, 36, 'Dãy B - Kệ 1 - Ô 04', '/images/products/VGA-RTX4070S.png', '12GB GDDR6X | 192-bit | DLSS 3 | 3 Quạt Windforce'),
('RAM-GSK-32G', 'RAM G.Skill Trident Z5 RGB 32GB (2x16GB) DDR5 6000MHz', 3, 'G.Skill', 'Bộ', 2650000, 3190000, 11, 4, 36, 'Dãy C - Kệ 1 - Ô 04', '/images/products/RAM-GSK-32G.png', '32GB (2x16GB) DDR5 | Bus 6000MHz | CL30 | RGB'),
('RAM-COS-16G', 'RAM Corsair Vengeance LPX 16GB DDR4 3200MHz', 3, 'Corsair', 'Thanh', 780000, 990000, 25, 10, 36, 'Dãy C - Kệ 1 - Ô 02', '/images/products/RAM-COS-16G.png', '16GB (1x16GB) DDR4 | Bus 3200MHz | CL16'),
('SSD-WD-SN770-1T', 'SSD WD Black SN770 1TB M.2 NVMe Gen4', 4, 'WD', 'Chiếc', 1550000, 1890000, 9, 4, 60, 'Dãy C - Kệ 2 - Ô 02', '/images/products/SSD-WD-SN770-1T.png', '1TB M.2 NVMe PCIe 4.0 | Đọc 5150MB/s'),
('SSD-SAM-980-1T', 'SSD Samsung 980 PRO 1TB PCIe 4.0 NVMe', 4, 'Samsung', 'Chiếc', 1850000, 2290000, 12, 5, 60, 'Dãy C - Kệ 2 - Ô 03', '/images/products/SSD-SAM-980-1T.png', '1TB M.2 NVMe PCIe 4.0 | Đọc 7000MB/s'),
('MB-B760M-A', 'Mainboard ASUS PRIME B760M-A D4', 5, 'ASUS', 'Chiếc', 2650000, 3190000, 4, 5, 36, 'Dãy D - Kệ 1 - Ô 01', '/images/products/MB-B760M-A.jpg', 'Socket LGA1700 | m-ATX | 4 Khe RAM DDR4'),
('MB-B650M-P', 'Mainboard MSI PRO B650M-P (AM5 / DDR5)', 5, 'MSI', 'Chiếc', 2950000, 3490000, 7, 3, 36, 'Dãy D - Kệ 1 - Ô 04', '/images/products/MB-B650M-P.png', 'Socket AM5 | m-ATX | 4 Khe RAM DDR5 | 2x M.2'),
('PSU-COS-650W', 'Nguồn Corsair CX650 650W 80 Plus Bronze', 6, 'Corsair', 'Chiếc', 1250000, 1590000, 12, 5, 36, 'Dãy B - Kệ 3 - Ô 02', '/images/products/PSU-COS-650W.png', '650W Công suất thực | 80 Plus Bronze | Quạt 120mm'),
('COOL-AK400', 'Tản nhiệt khí DeepCool AK400 Digital', 7, 'DeepCool', 'Chiếc', 620000, 850000, 15, 5, 24, 'Dãy A - Kệ 3 - Ô 01', '/images/products/COOL-AK400.png', '4 Ống đồng | Màn hình hiển thị nhiệt độ CPU | LGA1700/AM5'),
('HDD-SEA-2TB', 'Ổ cứng HDD Seagate Barracuda 2TB 7200rpm', 4, 'Seagate', 'Chiếc', 1350000, 1690000, 8, 3, 24, 'Dãy C - Kệ 3 - Ô 01', '/images/products/HDD-SEA-2TB.jpg', '2TB | 3.5 inch SATA III | 7200rpm | Cache 256MB'),
('MON-LG-24GN', 'Màn hình LG UltraGear 24GN65R-B 24" IPS 144Hz', 8, 'LG', 'Chiếc', 3450000, 4190000, 6, 3, 24, 'Dãy D - Kệ 2 - Ô 02', '/images/products/MON-LG-24GN.jpg', '24 inch FHD | Tấm nền IPS | 144Hz | 1ms GtG'),
('GEAR-LOGI-G304', 'Chuột không dây Logitech G304 Lightspeed', 9, 'Logitech', 'Chiếc', 680000, 890000, 14, 5, 24, 'Dãy D - Kệ 3 - Ô 01', '/images/products/GEAR-LOGI-G304.png', 'Cảm biến HERO 12000 DPI | Không dây Lightspeed 1ms'),
('GEAR-AKKO-3087', 'Bàn phím cơ Akko 3087 RF Matcha Red Bean', 9, 'Akko', 'Chiếc', 1150000, 1490000, 9, 4, 12, 'Dãy D - Kệ 3 - Ô 02', '/images/products/GEAR-AKKO-3087.png', 'Layout TKL 87 phím | Dual Mode | Switch Akko Cream Yellow'),
('ACC-TPLINK-AX', 'Card Wi-Fi 6 & Bluetooth 5.2 TP-Link Archer TX55E', 10, 'TP-Link', 'Chiếc', 750000, 990000, 10, 4, 24, 'Dãy D - Kệ 4 - Ô 01', '/images/products/ACC-TPLINK-AX.png', 'PCIe Wi-Fi 6 AX3000 | Bluetooth 5.2 | 2 Ăng-ten rời'),
('ACC-MX4-4G', 'Keo tản nhiệt Arctic MX-4 (Tuýp 4g)', 10, 'Arctic', 'Tuýp', 110000, 180000, 30, 10, 12, 'Dãy A - Kệ 3 - Ô 03', '/images/products/ACC-MX4-4G.jpg', 'Dẫn nhiệt 8.5 W/mK | Không dẫn điện | Kèm que trét'),
('CPU-I3-12100F', 'CPU Intel Core i3-12100F (4 nhân 8 luồng)', 1, 'Intel', 'Cái', 1850000, 2290000, 12, 4, 36, 'Dãy A - Kệ 1 - Ô 01', '/images/products/CPU-I3-12100F.png', 'Socket LGA1700 | 4 Nhân 8 Luồng | Boost 4.3GHz'),
('CPU-R7-7800X3D', 'CPU AMD Ryzen 7 7800X3D (3D V-Cache Gaming)', 1, 'AMD', 'Cái', 9400000, 10890000, 4, 2, 36, 'Dãy A - Kệ 2 - Ô 02', '/images/products/CPU-R7-7800X3D.png', 'Socket AM5 | 8 Nhân 16 Luồng | 96MB L3 Cache'),
('VGA-GTX1650', 'VGA Gigabyte GeForce GTX 1650 D6 OC 4GB', 2, 'Gigabyte', 'Cái', 3100000, 3690000, 9, 4, 36, 'Dãy B - Kệ 1 - Ô 01', '/images/products/VGA-GTX1650.jpg', '4GB GDDR6 | 128-bit | Không cần nguồn phụ'),
('VGA-RX7800XT', 'VGA Sapphire Nitro+ AMD Radeon RX 7800 XT 16GB', 2, 'AMD', 'Cái', 12900000, 14590000, 3, 2, 36, 'Dãy B - Kệ 2 - Ô 02', '/images/products/VGA-RX7800XT.png', '16GB GDDR6 | 256-bit | PCIe 4.0 | 3 Quạt Tri-X'),
('RAM-KST-8G', 'RAM Kingston Fury Beast 8GB DDR4 3200MHz', 3, 'Kingston', 'Thanh', 420000, 550000, 20, 6, 36, 'Dãy C - Kệ 1 - Ô 01', '/images/products/RAM-KST-8G.png', '8GB (1x8GB) DDR4 | Bus 3200MHz | CL16'),
('RAM-COS-16G-D5', 'RAM Corsair Vengeance 16GB DDR5 5200MHz', 3, 'Corsair', 'Thanh', 1150000, 1450000, 10, 4, 36, 'Dãy C - Kệ 1 - Ô 02', '/images/products/RAM-COS-16G-D5.png', '16GB (1x16GB) DDR5 | Bus 5200MHz | Tản nhiệt nhôm'),
('SSD-KST-A400-256G', 'SSD Kingston A400 256GB SATA III 2.5"', 4, 'Kingston', 'Chiếc', 450000, 590000, 18, 5, 36, 'Dãy C - Kệ 2 - Ô 01', '/images/products/SSD-KST-A400-256G.png', '256GB SATA III 2.5" | Đọc 500MB/s | Phù hợp văn phòng'),
('SSD-SAM-990P-2T', 'SSD Samsung 990 PRO 2TB PCIe 4.0 NVMe', 4, 'Samsung', 'Chiếc', 3950000, 4590000, 5, 2, 60, 'Dãy C - Kệ 2 - Ô 04', '/images/products/SSD-SAM-990P-2T.png', '2TB M.2 NVMe PCIe 4.0 | Đọc 7450MB/s'),
('MB-H610M-K', 'Mainboard ASUS PRIME H610M-K D4', 5, 'ASUS', 'Chiếc', 1550000, 1890000, 11, 4, 36, 'Dãy D - Kệ 1 - Ô 01', '/images/products/MB-H610M-K.png', 'Socket LGA1700 | m-ATX | 2 Khe RAM DDR4'),
('MB-B760M-WF', 'Mainboard MSI MAG B760M Mortar WiFi II (DDR5)', 5, 'MSI', 'Chiếc', 4100000, 4790000, 6, 3, 36, 'Dãy D - Kệ 1 - Ô 02', '/images/products/MB-B760M-WF.jpg', 'Socket LGA1700 | m-ATX | DDR5 | Wi-Fi 6E + Bluetooth 5.3'),
('MB-Z790-P', 'Mainboard ASUS PRIME Z790-P WiFi (DDR5)', 5, 'ASUS', 'Chiếc', 5200000, 5990000, 4, 2, 36, 'Dãy D - Kệ 1 - Ô 02', '/images/products/MB-Z790-P.png', 'Socket LGA1700 | ATX | DDR5 | PCIe 5.0 | Wi-Fi 6'),
('MB-B550M-P', 'Mainboard Gigabyte B550M AORUS Elite (AM4)', 5, 'Gigabyte', 'Chiếc', 2350000, 2790000, 6, 3, 36, 'Dãy D - Kệ 1 - Ô 03', '/images/products/MB-B550M-P.png', 'Socket AM4 | m-ATX | 4 Khe RAM DDR4 | 2x M.2'),
('PSU-XIG-450W', 'Nguồn Xigmatek X-Power III 450W', 6, 'Xigmatek', 'Chiếc', 520000, 690000, 15, 5, 36, 'Dãy B - Kệ 3 - Ô 01', '/images/products/PSU-XIG-450W.png', '450W | Quạt 120mm êm ái | Phù hợp PC văn phòng'),
('PSU-MSI-750GL', 'Nguồn MSI MAG A750GL PCIE5 750W 80 Plus Gold', 6, 'MSI', 'Chiếc', 2250000, 2690000, 7, 3, 60, 'Dãy B - Kệ 3 - Ô 03', '/images/products/PSU-MSI-750GL.png', '750W Full Modular | 80 Plus Gold | Chuẩn ATX 3.0'),
('PSU-COS-RM850E', 'Nguồn Corsair RM850e 850W 80 Plus Gold ATX 3.0', 6, 'Corsair', 'Chiếc', 2850000, 3390000, 4, 2, 84, 'Dãy B - Kệ 3 - Ô 04', '/images/products/PSU-COS-RM850E.png', '850W Full Modular | 80 Plus Gold | Cáp 12VHPWR'),
('CASE-XIG-NYX', 'Vỏ Case Xigmatek NYX II 3F (m-ATX)', 7, 'Xigmatek', 'Chiếc', 550000, 750000, 10, 4, 12, 'Dãy B - Kệ 4 - Ô 01', '/images/products/CASE-XIG-NYX.png', 'Kính cường lực hông | Sẵn 3 Fan LED | Hỗ trợ m-ATX'),
('CASE-MON-AIR100', 'Vỏ Case Montech AIR 100 ARGB Mesh', 7, 'Montech', 'Chiếc', 1050000, 1350000, 8, 3, 12, 'Dãy B - Kệ 4 - Ô 02', '/images/products/CASE-MON-AIR100.jpg', 'Mặt lưới thoáng khí | Sẵn 4 Fan ARGB | m-ATX'),
('CASE-NZXT-H6', 'Vỏ Case NZXT H6 Flow Kính Bể Cá (ATX)', 7, 'NZXT', 'Chiếc', 2450000, 2890000, 4, 2, 24, 'Dãy B - Kệ 4 - Ô 03', '/images/products/CASE-NZXT-H6.jpg', 'Thiết kế 2 buồng kính bể cá | Hỗ trợ Radiator 360mm'),
('COOL-LT520', 'Tản nhiệt nước AIO DeepCool LT520 240mm', 7, 'DeepCool', 'Chiếc', 2150000, 2590000, 5, 2, 60, 'Dãy A - Kệ 3 - Ô 02', '/images/products/COOL-LT520.png', 'Radiator 240mm | Block bơm vô cực ARGB | LGA1700/AM5'),
('MON-DELL-E2222H', 'Màn hình Dell E2222H 21.5" FHD VA 60Hz', 8, 'Dell', 'Chiếc', 2150000, 2590000, 9, 4, 36, 'Dãy D - Kệ 2 - Ô 01', '/images/products/MON-DELL-E2222H.jpg', '21.5 inch FHD | Tấm nền VA | Cổng DP + VGA | Văn phòng'),
('MON-ASUS-VG249Q3A', 'Màn hình Gaming ASUS TUF VG249Q3A 24" IPS 180Hz', 8, 'ASUS', 'Chiếc', 3250000, 3890000, 8, 3, 36, 'Dãy D - Kệ 2 - Ô 03', '/images/products/MON-ASUS-VG249Q3A.jpg', '24 inch FHD | Fast IPS | 180Hz | 1ms GTG | Loa tích hợp'),
('MON-GIGA-M27Q', 'Màn hình Gigabyte M27Q 27" 2K QHD IPS 180Hz', 8, 'Gigabyte', 'Chiếc', 5600000, 6490000, 4, 2, 36, 'Dãy D - Kệ 2 - Ô 04', '/images/products/MON-GIGA-M27Q.png', '27 inch 2K (2560x1440) | SS IPS | 180Hz | KVM Switch'),
('MON-ZOWIE-XL2546X', 'Màn hình Esports BenQ ZOWIE XL2546X 24.5" 240Hz', 8, 'BenQ', 'Chiếc', 10500000, 11990000, 2, 2, 36, 'Dãy D - Kệ 2 - Ô 04', '/images/products/MON-ZOWIE-XL2546X.jpg', '24.5 inch FHD | Fast TN | 240Hz | DyAc 2 Esports'),
('GEAR-LOGI-GPX2', 'Chuột Gaming Logitech G Pro X Superlight 2', 9, 'Logitech', 'Chiếc', 2950000, 3490000, 6, 3, 24, 'Dãy D - Kệ 3 - Ô 01', '/images/products/GEAR-LOGI-GPX2.png', 'Siêu nhẹ 60g | Cảm biến HERO 2 32000 DPI | Polling 4000Hz'),
('GEAR-AULA-F75', 'Bàn phím cơ không dây AULA F75 Gasket Mount', 9, 'AULA', 'Chiếc', 980000, 1290000, 12, 4, 12, 'Dãy D - Kệ 3 - Ô 02', '/images/products/GEAR-AULA-F75.png', 'Layout 75% | 3 Mode Kết nối | Núm xoay | Mạch xuôi Hot-swap'),
('GEAR-HYP-CLOUD3', 'Tai nghe Gaming HyperX Cloud III (Đen Đỏ)', 9, 'HyperX', 'Chiếc', 1650000, 2090000, 7, 3, 24, 'Dãy D - Kệ 3 - Ô 03', '/images/products/GEAR-HYP-CLOUD3.png', 'Driver 53mm | Đệm tai Memory Foam | Mic chống ồn'),
('GEAR-PAD-900', 'Lót chuột Gaming DareU ESP109 XL (900x400x5mm)', 9, 'DareU', 'Chiếc', 120000, 190000, 25, 8, 6, 'Dãy D - Kệ 3 - Ô 04', '/images/products/GEAR-PAD-900.png', 'Kích thước 900x400mm | Dày 5mm | Bo viền chống tưa'),
('ACC-NBF80', 'Giá đỡ màn hình đơn North Bayou NB F80', 10, 'North Bayou', 'Chiếc', 320000, 450000, 14, 5, 12, 'Dãy D - Kệ 4 - Ô 03', '/images/products/ACC-NBF80.jpg', 'Tay nâng khí nén | Hỗ trợ màn 17"-30" | Tải trọng 2-9kg'),
('ACC-UGREEN-DP14', 'Cáp xuất hình Ugreen DisplayPort 1.4 8K60Hz (2m)', 10, 'Ugreen', 'Sợi', 160000, 250000, 20, 6, 18, 'Dãy D - Kệ 4 - Ô 02', '/images/products/ACC-UGREEN-DP14.jpg', 'Băng thông 32.4Gbps | Hỗ trợ 2K 240Hz / 4K 144Hz'),
('ACC-FAN-3IN1', 'Bộ 3 Fan Case Thermalright TL-C12C-S ARGB', 10, 'Thermalright', 'Bộ', 290000, 390000, 12, 4, 12, 'Dãy A - Kệ 3 - Ô 04', '/images/products/ACC-FAN-3IN1.png', '3 Quạt 120mm PWM | LED ARGB 5V | Kèm hub chia');

INSERT INTO warranty_serials (product_id, receipt_id, invoice_id, serial_number, status) VALUES
(1, 1, NULL, 'SN-I5-2026-0001', 'TrongKho'),
(1, 1, 1, 'SN-I5-2026-0002', 'DaBan'),
(5, 1, NULL, 'SN-4060-2026-0001', 'TrongKho'),
(5, 1, 1, 'SN-4060-2026-0002', 'DaBan'),
(12, 2, NULL, 'SN-980P-2026-0001', 'TrongKho');

INSERT INTO purchase_receipts (receipt_no, supplier_invoice_no, supplier_id, user_id, receipt_date, total_amount, paid_amount, warehouse_status, notes) VALUES
('PN-202611-001', 'VS-001289', 1, 2, CURRENT_TIMESTAMP - INTERVAL '3 days', 42000000, 27000000, 'DaNhapKho', 'Nhập lô CPU i5 và VGA RTX 4060 đầu tháng'),
('PN-202611-002', 'SY-008841', 3, 2, CURRENT_TIMESTAMP - INTERVAL '1 day', 19500000, 11000000, 'DaNhapKho', 'Nhập bổ sung RAM và SSD Samsung');

INSERT INTO purchase_details (receipt_id, product_id, quantity, import_price, line_total) VALUES
(1, 1, 5, 4200000, 21000000),
(1, 5, 3, 7000000, 21000000),
(2, 10, 15, 780000, 11700000),
(2, 12, 4, 1950000, 7800000);

INSERT INTO invoices (invoice_no, customer_id, user_id, invoice_date, subtotal, vat_amount, total_amount, paid_amount, debt_amount, payment_method, payment_status, notes) VALUES
('HD-202611-001', 3, 3, CURRENT_TIMESTAMP - INTERVAL '2 days', 13180000, 1318000, 14498000, 14498000, 0, 'ChuyenKhoan', 'DaThanhToan', 'Bán bộ CPU + VGA cho Gaming Net'),
('HD-202611-002', 2, 3, CURRENT_TIMESTAMP - INTERVAL '4 hours', 8260000, 826000, 9086000, 4586000, 4500000, 'ChuyenKhoan', 'ThanhToanMotPhan', 'Công ty Kiến An thanh toán trước 4.586tr, ghi nợ 4.5tr'),
('HD-202611-003', 4, 3, CURRENT_TIMESTAMP - INTERVAL '1 hour', 3280000, 328000, 3608000, 2408000, 1200000, 'TienMat', 'ThanhToanMotPhan', 'Chị Hà mua SSD + RAM');

INSERT INTO invoice_details (invoice_id, product_id, quantity, unit_price, line_total) VALUES
(1, 1, 1, 4890000, 4890000),
(1, 5, 1, 8290000, 8290000),
(2, 2, 1, 5290000, 5290000),
(2, 10, 3, 990000, 2970000),
(3, 12, 1, 2290000, 2290000),
(3, 10, 1, 990000, 990000);

INSERT INTO payments (payment_no, payment_type, invoice_id, receipt_id, user_id, amount, payment_method, notes) VALUES
('PT-202611-001', 'Thu', 1, NULL, 3, 14498000, 'ChuyenKhoan', 'Thu tiền hóa đơn HD-202611-001'),
('PT-202611-002', 'Thu', 2, NULL, 2, 4586000, 'ChuyenKhoan', 'Thu tạm ứng hóa đơn HD-202611-002'),
('PT-202611-003', 'Thu', 3, NULL, 3, 2408000, 'TienMat', 'Thu tạm ứng hóa đơn HD-202611-003'),
('PC-202611-001', 'Chi', NULL, 1, 2, 27000000, 'ChuyenKhoan', 'Thanh toán 1 phần phiếu nhập PN-202611-001'),
('PC-202611-002', 'Chi', NULL, 2, 2, 11000000, 'ChuyenKhoan', 'Thanh toán 1 phần phiếu nhập PN-202611-002');

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');

const router = express.Router();

function genDocNo(prefix) {
  return `${prefix}-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Chưa đăng nhập.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

const isValidPhone = (p) => /^0\d{8,10}$/.test((p || '').trim());

// ============================================================================
// 1. LOẠI HÀNG (CATEGORIES)
// ============================================================================
router.get('/categories', requireAuth, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const result = await pool.query(
      `SELECT c.*, COUNT(p.product_id)::INT AS product_count
       FROM categories c
       LEFT JOIN products p ON c.category_id = p.category_id
       WHERE c.category_name ILIKE $1 OR COALESCE(c.description, '') ILIKE $1
       GROUP BY c.category_id
       ORDER BY c.category_id DESC`,
      [q]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách loại hàng.' });
  }
});

router.post('/categories', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const { category_name, description } = req.body;
    if (!category_name || !category_name.trim()) {
      return res.status(400).json({ error: 'Tên loại hàng không được để trống.' });
    }
    const result = await pool.query(
      'INSERT INTO categories (category_name, description) VALUES ($1, $2) RETURNING *',
      [category_name.trim(), (description || '').trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Tên loại hàng đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi thêm loại hàng.' });
  }
});

router.put('/categories/:id', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const { category_name, description } = req.body;
    if (!category_name || !category_name.trim()) {
      return res.status(400).json({ error: 'Tên loại hàng không được để trống.' });
    }
    const result = await pool.query(
      'UPDATE categories SET category_name = $1, description = $2 WHERE category_id = $3 RETURNING *',
      [category_name.trim(), (description || '').trim(), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy loại hàng.' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Tên loại hàng đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi cập nhật loại hàng.' });
  }
});

router.delete('/categories/:id', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM categories WHERE category_id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy loại hàng.' });
    res.json({ message: 'Đã xóa loại hàng.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Không thể xóa loại hàng đang có sản phẩm liên kết.' });
    }
    res.status(500).json({ error: 'Lỗi xóa loại hàng.' });
  }
});

// ============================================================================
// 2. SẢN PHẨM / LINH KIỆN (PRODUCTS)
// ============================================================================
router.get('/products', requireAuth, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const categoryId = req.query.category_id;
    const stockStatus = req.query.stock_status || 'all';
    const sort = req.query.sort || 'newest';

    let sql = `
      SELECT p.*, c.category_name
      FROM products p
      JOIN categories c ON p.category_id = c.category_id
      WHERE (p.sku ILIKE $1 OR p.product_name ILIKE $1 OR c.category_name ILIKE $1 OR COALESCE(p.brand, '') ILIKE $1)
    `;
    const params = [q];
    if (categoryId) {
      params.push(Number(categoryId));
      sql += ` AND p.category_id = $${params.length}`;
    }
    if (stockStatus === 'low') {
      sql += ' AND p.stock_qty > 0 AND p.stock_qty <= p.min_stock';
    } else if (stockStatus === 'out') {
      sql += ' AND p.stock_qty = 0';
    }

    if (sort === 'price_asc') sql += ' ORDER BY p.sale_price ASC';
    else if (sort === 'price_desc') sql += ' ORDER BY p.sale_price DESC';
    else if (sort === 'stock_asc') sql += ' ORDER BY p.stock_qty ASC';
    else if (sort === 'stock_desc') sql += ' ORDER BY p.stock_qty DESC';
    else sql += ' ORDER BY p.product_id DESC';

    const result = await pool.query(sql, params);
    const rows =
      req.session.user.role === 'BanHang'
        ? result.rows.map((p) => ({ ...p, import_price: null }))
        : result.rows;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách sản phẩm.' });
  }
});

router.post('/products', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const {
      sku, product_name, category_id, brand, unit, import_price, sale_price,
      stock_qty, min_stock, warranty_months, shelf_location, image_url, specs, is_active
    } = req.body;
    if (!sku || !sku.trim() || !product_name || !product_name.trim() || !category_id) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Mã SKU, Tên sản phẩm và Loại hàng.' });
    }
    if (Number(import_price) < 0 || Number(sale_price) < 0 || Number(stock_qty || 0) < 0 || Number(min_stock || 0) < 0) {
      return res.status(400).json({ error: 'Giá và số lượng tồn không được nhỏ hơn 0.' });
    }

    const result = await pool.query(
      `INSERT INTO products (sku, product_name, category_id, brand, unit, import_price, sale_price, stock_qty, min_stock, warranty_months, shelf_location, image_url, specs, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        sku.trim().toUpperCase(),
        product_name.trim(),
        Number(category_id),
        (brand || '').trim(),
        (unit || 'Cái').trim(),
        Number(import_price || 0),
        Number(sale_price || 0),
        Number(stock_qty || 0),
        Number(min_stock ?? 5),
        Number(warranty_months ?? 12),
        (shelf_location || '').trim(),
        (image_url || '').trim() || null,
        (specs || '').trim(),
        is_active !== false,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Mã SKU đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi thêm sản phẩm.' });
  }
});

router.put('/products/:id', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const {
      sku, product_name, category_id, brand, unit, import_price, sale_price,
      min_stock, warranty_months, shelf_location, image_url, specs, is_active
    } = req.body;
    if (!sku || !sku.trim() || !product_name || !product_name.trim() || !category_id) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Mã SKU, Tên sản phẩm và Loại hàng.' });
    }
    if (Number(import_price) < 0 || Number(sale_price) < 0 || Number(min_stock || 0) < 0) {
      return res.status(400).json({ error: 'Giá và tồn tối thiểu không được nhỏ hơn 0.' });
    }

    const result = await pool.query(
      `UPDATE products
       SET sku = $1, product_name = $2, category_id = $3, brand = $4, unit = $5,
           import_price = $6, sale_price = $7, min_stock = $8, warranty_months = $9,
           shelf_location = $10, image_url = $11, specs = $12, is_active = $13
       WHERE product_id = $14 RETURNING *`,
      [
        sku.trim().toUpperCase(),
        product_name.trim(),
        Number(category_id),
        (brand || '').trim(),
        (unit || 'Cái').trim(),
        Number(import_price || 0),
        Number(sale_price || 0),
        Number(min_stock ?? 5),
        Number(warranty_months ?? 12),
        (shelf_location || '').trim(),
        (image_url || '').trim() || null,
        (specs || '').trim(),
        is_active !== false,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Mã SKU đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi cập nhật sản phẩm.' });
  }
});

router.delete('/products/:id', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE product_id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    res.json({ message: 'Đã xóa sản phẩm.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Không thể xóa sản phẩm đã có lịch sử nhập/xuất kho.' });
    }
    res.status(500).json({ error: 'Lỗi xóa sản phẩm.' });
  }
});

// ============================================================================
// 3. KHÁCH HÀNG (CUSTOMERS)
// ============================================================================
router.get('/customers', requireAuth, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const hasDebt = req.query.has_debt === 'true';
    const group = (req.query.customer_group || '').trim();

    let sql = `
      SELECT * FROM customers
      WHERE (customer_name ILIKE $1 OR phone ILIKE $1 OR COALESCE(address, '') ILIKE $1 OR COALESCE(tax_code, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1)
    `;
    const params = [q];
    if (hasDebt) {
      sql += ' AND debt_amount > 0';
    }
    if (group) {
      params.push(group);
      sql += ` AND customer_group = $${params.length}`;
    }
    sql += ' ORDER BY customer_id DESC';

    const result = await pool.query(sql, params);
    const rows =
      req.session.user.role === 'BanHang'
        ? result.rows.map((p) => ({ ...p, import_price: null }))
        : result.rows;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách khách hàng.' });
  }
});

router.post('/customers', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  try {
    const { customer_name, phone, tax_code, email, customer_group, address, credit_limit } = req.body;
    if (!customer_name || !customer_name.trim() || !phone || !phone.trim()) {
      return res.status(400).json({ error: 'Tên khách hàng và Số điện thoại là bắt buộc.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ (bắt đầu bằng 0, 9-11 chữ số).' });
    }
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Địa chỉ Email không hợp lệ.' });
    }
    if (Number(credit_limit || 0) < 0) {
      return res.status(400).json({ error: 'Hạn mức công nợ không được âm.' });
    }

    const result = await pool.query(
      `INSERT INTO customers (customer_name, phone, tax_code, email, customer_group, address, credit_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        customer_name.trim(),
        phone.trim(),
        tax_code ? tax_code.trim() : null,
        email ? email.trim() : null,
        customer_group || 'KhachLe',
        (address || '').trim(),
        Number(credit_limit ?? 10000000),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Số điện thoại khách hàng đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi thêm khách hàng.' });
  }
});

router.put('/customers/:id', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  try {
    const { customer_name, phone, tax_code, email, customer_group, address, credit_limit } = req.body;
    if (!customer_name || !customer_name.trim() || !phone || !phone.trim()) {
      return res.status(400).json({ error: 'Tên khách hàng và Số điện thoại là bắt buộc.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Địa chỉ Email không hợp lệ.' });
    }
    if (Number(credit_limit || 0) < 0) {
      return res.status(400).json({ error: 'Hạn mức công nợ không được âm.' });
    }

    const effectiveCreditLimit = Number(req.params.id) === 1 ? 0 : Number(credit_limit ?? 10000000);
    const result = await pool.query(
      `UPDATE customers
       SET customer_name = $1, phone = $2, tax_code = $3, email = $4, customer_group = $5, address = $6, credit_limit = $7
       WHERE customer_id = $8 RETURNING *`,
      [
        customer_name.trim(),
        phone.trim(),
        tax_code ? tax_code.trim() : null,
        email ? email.trim() : null,
        customer_group || 'KhachLe',
        (address || '').trim(),
        effectiveCreditLimit,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy khách hàng.' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Số điện thoại đã thuộc về khách hàng khác.' });
    res.status(500).json({ error: 'Lỗi cập nhật khách hàng.' });
  }
});

router.delete('/customers/:id', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    if (Number(req.params.id) === 1) {
      return res.status(400).json({ error: 'Không thể xóa khách hàng mặc định (#1 Khách lẻ tại quầy).' });
    }
    const check = await pool.query('SELECT debt_amount FROM customers WHERE customer_id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy khách hàng.' });
    if (Number(check.rows[0].debt_amount) > 0) {
      return res.status(400).json({ error: 'Không thể xóa khách hàng đang có số dư công nợ (TK 131) > 0.' });
    }

    const result = await pool.query('DELETE FROM customers WHERE customer_id = $1 RETURNING *', [req.params.id]);
    res.json({ message: 'Đã xóa khách hàng.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Không thể xóa khách hàng đã có lịch sử hóa đơn giao dịch.' });
    }
    res.status(500).json({ error: 'Lỗi xóa khách hàng.' });
  }
});

// Lịch sử giao dịch & tra cứu bảo hành theo khách hàng
router.get('/customers/:id/history', requireAuth, async (req, res) => {
  try {
    const custRes = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [req.params.id]);
    if (custRes.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy khách hàng.' });

    const invoicesRes = await pool.query(
      `SELECT i.invoice_id, i.invoice_no, i.invoice_date, i.total_amount, i.paid_amount, i.debt_amount, i.payment_status
       FROM invoices i
       WHERE i.customer_id = $1
       ORDER BY i.invoice_date DESC`,
      [req.params.id]
    );

    const itemsRes = await pool.query(
      `SELECT i.invoice_no, i.invoice_date, p.sku, p.product_name, p.warranty_months, id.quantity, id.unit_price
       FROM invoice_details id
       JOIN invoices i ON id.invoice_id = i.invoice_id
       JOIN products p ON id.product_id = p.product_id
       WHERE i.customer_id = $1
       ORDER BY i.invoice_date DESC`,
      [req.params.id]
    );

    res.json({
      customer: custRes.rows[0],
      invoices: invoicesRes.rows,
      purchasedItems: itemsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải lịch sử giao dịch khách hàng.' });
  }
});

// Thu nợ khách hàng (giảm TK 131 + cập nhật hóa đơn nợ + tạo phiếu thu)
router.post('/customers/:id/collect-debt', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount || 0);
    const paymentMethod = req.body.payment_method || 'ChuyenKhoan';
    const notes = (req.body.notes || '').trim();

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Số tiền thu nợ phải lớn hơn 0.' });
    }

    await client.query('BEGIN');

    const custRes = await client.query('SELECT * FROM customers WHERE customer_id = $1 FOR UPDATE', [req.params.id]);
    if (custRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy khách hàng.' });
    }
    const cust = custRes.rows[0];
    const currentDebt = Number(cust.debt_amount);
    if (currentDebt <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Khách hàng này hiện không có công nợ.' });
    }
    if (amount > currentDebt) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Số tiền thu (${amount.toLocaleString('vi-VN')} ₫) vượt quá công nợ hiện tại (${currentDebt.toLocaleString('vi-VN')} ₫).` });
    }

    // Trừ công nợ tổng của khách hàng
    await client.query('UPDATE customers SET debt_amount = debt_amount - $1 WHERE customer_id = $2', [amount, cust.customer_id]);

    // Phân bổ tiền thu vào các hóa đơn còn nợ (từ cũ nhất đến mới nhất)
    let remaining = amount;
    let firstInvoiceId = null;
    const paidInvoiceNos = [];
    const unpaidInvs = await client.query(
      `SELECT invoice_id, invoice_no, total_amount, paid_amount, debt_amount
       FROM invoices
       WHERE customer_id = $1 AND debt_amount > 0 AND payment_status IN ('GhiNo', 'ThanhToanMotPhan')
       ORDER BY invoice_date ASC FOR UPDATE`,
      [cust.customer_id]
    );
    for (const inv of unpaidInvs.rows) {
      if (remaining <= 0) break;
      const invDebt = Number(inv.debt_amount);
      const payHere = Math.min(remaining, invDebt);
      const newDebt = invDebt - payHere;
      const newStatus = newDebt === 0 ? 'DaThanhToan' : 'ThanhToanMotPhan';
      await client.query(
        'UPDATE invoices SET paid_amount = paid_amount + $1, debt_amount = $2, payment_status = $3 WHERE invoice_id = $4',
        [payHere, newDebt, newStatus, inv.invoice_id]
      );
      if (!firstInvoiceId) firstInvoiceId = inv.invoice_id;
      paidInvoiceNos.push(inv.invoice_no);
      remaining -= payHere;
    }

    // Ghi phiếu thu vào bảng payments
    const payNo = genDocNo('PT');
    const safeMethod = ['TienMat', 'ChuyenKhoan', 'QuetThe'].includes(paymentMethod) ? paymentMethod : 'ChuyenKhoan';
    const defaultNotes =
      paidInvoiceNos.length > 0
        ? `Thu công nợ khách hàng ${cust.customer_name} (${paidInvoiceNos.join(', ')})`
        : `Thu công nợ khách hàng ${cust.customer_name}`;
    await client.query(
      `INSERT INTO payments (payment_no, payment_type, invoice_id, user_id, amount, payment_method, notes)
       VALUES ($1, 'Thu', $2, $3, $4, $5, $6)`,
      [payNo, firstInvoiceId, req.session.user.user_id, amount, safeMethod, notes || defaultNotes]
    );

    await client.query('COMMIT');
    res.json({ message: 'Đã thu nợ thành công!', remaining_debt: currentDebt - amount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Lỗi thu công nợ: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 4. NHÀ CUNG CẤP (SUPPLIERS)
// ============================================================================
router.get('/suppliers', requireAuth, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const hasDebt = req.query.has_debt === 'true';

    let sql = `
      SELECT * FROM suppliers
      WHERE (supplier_name ILIKE $1 OR phone ILIKE $1 OR COALESCE(tax_code, '') ILIKE $1
             OR COALESCE(sale_contact, '') ILIKE $1 OR COALESCE(bank_account, '') ILIKE $1)
    `;
    if (hasDebt) {
      sql += ' AND payable_balance > 0';
    }
    sql += ' ORDER BY supplier_id DESC';

    const result = await pool.query(sql, [q]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách nhà cung cấp.' });
  }
});

router.post('/suppliers', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const { supplier_name, phone, tax_code, address, sale_contact, rma_address, bank_account } = req.body;
    if (!supplier_name || !supplier_name.trim() || !phone || !phone.trim()) {
      return res.status(400).json({ error: 'Tên nhà cung cấp và Số điện thoại là bắt buộc.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Số điện thoại nhà cung cấp không hợp lệ.' });
    }
    const result = await pool.query(
      `INSERT INTO suppliers (supplier_name, phone, tax_code, address, sale_contact, rma_address, bank_account)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        supplier_name.trim(),
        phone.trim(),
        tax_code ? tax_code.trim() : null,
        (address || '').trim(),
        (sale_contact || '').trim(),
        (rma_address || '').trim(),
        (bank_account || '').trim(),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Mã số thuế đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi thêm nhà cung cấp.' });
  }
});

router.put('/suppliers/:id', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const { supplier_name, phone, tax_code, address, sale_contact, rma_address, bank_account } = req.body;
    if (!supplier_name || !supplier_name.trim() || !phone || !phone.trim()) {
      return res.status(400).json({ error: 'Tên nhà cung cấp và Số điện thoại là bắt buộc.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }
    const result = await pool.query(
      `UPDATE suppliers
       SET supplier_name = $1, phone = $2, tax_code = $3, address = $4,
           sale_contact = $5, rma_address = $6, bank_account = $7
       WHERE supplier_id = $8 RETURNING *`,
      [
        supplier_name.trim(),
        phone.trim(),
        tax_code ? tax_code.trim() : null,
        (address || '').trim(),
        (sale_contact || '').trim(),
        (rma_address || '').trim(),
        (bank_account || '').trim(),
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp.' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Mã số thuế đã thuộc về nhà cung cấp khác.' });
    res.status(500).json({ error: 'Lỗi cập nhật nhà cung cấp.' });
  }
});

router.delete('/suppliers/:id', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    const check = await pool.query('SELECT payable_balance FROM suppliers WHERE supplier_id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp.' });
    if (Number(check.rows[0].payable_balance) > 0) {
      return res.status(400).json({ error: 'Không thể xóa nhà cung cấp đang có dư nợ phải trả (TK 331) > 0.' });
    }

    await pool.query('DELETE FROM suppliers WHERE supplier_id = $1 RETURNING *', [req.params.id]);
    res.json({ message: 'Đã xóa nhà cung cấp.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Không thể xóa nhà cung cấp đã có lịch sử phiếu nhập hàng.' });
    }
    res.status(500).json({ error: 'Lỗi xóa nhà cung cấp.' });
  }
});

// Lịch sử nhập hàng & đối chiếu công nợ NCC
router.get('/suppliers/:id/history', requireAuth, async (req, res) => {
  try {
    const supRes = await pool.query('SELECT * FROM suppliers WHERE supplier_id = $1', [req.params.id]);
    if (supRes.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp.' });

    const receiptsRes = await pool.query(
      `SELECT pr.*, u.full_name AS staff_name
       FROM purchase_receipts pr
       JOIN users u ON pr.user_id = u.user_id
       WHERE pr.supplier_id = $1
       ORDER BY pr.receipt_date DESC`,
      [req.params.id]
    );

    res.json({
      supplier: supRes.rows[0],
      receipts: receiptsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải lịch sử nhập hàng nhà cung cấp.' });
  }
});

// Trả nợ Nhà cung cấp (giảm TK 331 + cập nhật phiếu nhập + tạo Phiếu Chi)
router.post('/suppliers/:id/pay-debt', requireRole('Admin', 'KeToan'), async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount || 0);
    const paymentMethod = req.body.payment_method || 'ChuyenKhoan';
    const notes = (req.body.notes || '').trim();

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Số tiền thanh toán phải lớn hơn 0.' });
    }

    await client.query('BEGIN');

    const supRes = await client.query('SELECT * FROM suppliers WHERE supplier_id = $1 FOR UPDATE', [req.params.id]);
    if (supRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp.' });
    }
    const sup = supRes.rows[0];
    const currentPayable = Number(sup.payable_balance);
    if (currentPayable <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nhà cung cấp này hiện không còn dư nợ phải trả.' });
    }
    if (amount > currentPayable) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Số tiền trả (${amount.toLocaleString('vi-VN')} ₫) vượt quá số nợ hiện tại (${currentPayable.toLocaleString('vi-VN')} ₫).` });
    }

    await client.query('UPDATE suppliers SET payable_balance = payable_balance - $1 WHERE supplier_id = $2', [
      amount,
      sup.supplier_id,
    ]);

    // Phân bổ tiền trả vào các phiếu nhập chưa thanh toán đủ
    let remaining = amount;
    let firstReceiptId = null;
    const paidReceiptNos = [];
    const unpaidReceipts = await client.query(
      `SELECT receipt_id, receipt_no, total_amount, paid_amount
       FROM purchase_receipts
       WHERE supplier_id = $1 AND total_amount > paid_amount
       ORDER BY receipt_date ASC FOR UPDATE`,
      [sup.supplier_id]
    );
    for (const r of unpaidReceipts.rows) {
      if (remaining <= 0) break;
      const owed = Number(r.total_amount) - Number(r.paid_amount);
      const payHere = Math.min(remaining, owed);
      await client.query('UPDATE purchase_receipts SET paid_amount = paid_amount + $1 WHERE receipt_id = $2', [
        payHere,
        r.receipt_id,
      ]);
      if (!firstReceiptId) firstReceiptId = r.receipt_id;
      paidReceiptNos.push(r.receipt_no);
      remaining -= payHere;
    }

    const payNo = genDocNo('PC');
    const safeMethod = ['TienMat', 'ChuyenKhoan', 'QuetThe'].includes(paymentMethod) ? paymentMethod : 'ChuyenKhoan';
    const defaultNotes =
      paidReceiptNos.length > 0
        ? `Trả nợ nhà cung cấp ${sup.supplier_name} (${paidReceiptNos.join(', ')})`
        : `Trả nợ nhà cung cấp ${sup.supplier_name}`;
    await client.query(
      `INSERT INTO payments (payment_no, payment_type, receipt_id, user_id, amount, payment_method, notes)
       VALUES ($1, 'Chi', $2, $3, $4, $5, $6)`,
      [payNo, firstReceiptId, req.session.user.user_id, amount, safeMethod, notes || defaultNotes]
    );

    await client.query('COMMIT');
    res.json({ message: 'Đã lập Phiếu Chi trả nợ thành công!', remaining_payable: currentPayable - amount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Lỗi thanh toán công nợ NCC: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 5. NGƯỜI DÙNG / NHÂN VIÊN (USERS) - CHỈ ADMIN
// ============================================================================
router.get('/users', requireRole('Admin'), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const result = await pool.query(
      `SELECT u.user_id, u.username, u.full_name, u.role, u.phone, u.is_active, u.last_login, u.created_at,
              (EXISTS(SELECT 1 FROM invoices i WHERE i.user_id = u.user_id)
               OR EXISTS(SELECT 1 FROM purchase_receipts pr WHERE pr.user_id = u.user_id)
               OR EXISTS(SELECT 1 FROM payments p WHERE p.user_id = u.user_id)) AS has_docs
       FROM users u
       WHERE u.username ILIKE $1 OR u.full_name ILIKE $1 OR u.role ILIKE $1
       ORDER BY u.user_id DESC`,
      [q]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách người dùng.' });
  }
});

router.post('/users', requireRole('Admin'), async (req, res) => {
  try {
    const { username, password, full_name, role, phone } = req.body;
    if (!username || !username.trim() || !password || !full_name || !full_name.trim() || !role) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Tên đăng nhập, Mật khẩu, Họ tên và Vai trò.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, username, full_name, role, phone, is_active, created_at`,
      [username.trim(), hash, full_name.trim(), role, (phone || '').trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại.' });
    res.status(500).json({ error: 'Lỗi thêm người dùng.' });
  }
});

router.put('/users/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { full_name, role, phone, is_active, password } = req.body;
    if (!full_name || !full_name.trim() || !role) {
      return res.status(400).json({ error: 'Họ tên và Vai trò không được để trống.' });
    }
    let result;
    if (password && password.trim().length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      }
      const hash = await bcrypt.hash(password, 10);
      result = await pool.query(
        `UPDATE users SET full_name = $1, role = $2, phone = $3, is_active = $4, password_hash = $5
         WHERE user_id = $6 RETURNING user_id, username, full_name, role, phone, is_active`,
        [full_name.trim(), role, (phone || '').trim(), is_active !== false, hash, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE users SET full_name = $1, role = $2, phone = $3, is_active = $4
         WHERE user_id = $5 RETURNING user_id, username, full_name, role, phone, is_active`,
        [full_name.trim(), role, (phone || '').trim(), is_active !== false, req.params.id]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật người dùng.' });
  }
});

router.delete('/users/:id', requireRole('Admin'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === 1) {
      return res.status(400).json({ error: 'Không thể xóa tài khoản Super Admin gốc (#1).' });
    }
    if (targetId === req.session.user.user_id) {
      return res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' });
    }
    const result = await pool.query('DELETE FROM users WHERE user_id = $1 RETURNING *', [targetId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    res.json({ message: 'Đã xóa người dùng.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Nhân viên đã lập chứng từ. Vui lòng dùng nút "Khóa" (Soft Delete) để giữ dấu vết kế toán.' });
    }
    res.status(500).json({ error: 'Lỗi xóa người dùng.' });
  }
});

// Reset nhanh mật khẩu về mặc định (123456) hoặc mật khẩu mới
router.post('/users/:id/reset-password', requireRole('Admin'), async (req, res) => {
  try {
    const newPass = (req.body.new_password || '123456').trim();
    if (newPass.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
    }
    const hash = await bcrypt.hash(newPass, 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE user_id = $2 RETURNING username',
      [hash, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    res.json({ message: `Đã đặt lại mật khẩu cho "${result.rows[0].username}" thành "${newPass}".` });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi đặt lại mật khẩu.' });
  }
});

// Khóa / Mở khóa tài khoản (Soft Delete)
router.post('/users/:id/toggle-active', requireRole('Admin'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === 1 || targetId === req.session.user.user_id) {
      return res.status(400).json({ error: 'Không thể khóa tài khoản Super Admin gốc hoặc tài khoản đang đăng nhập.' });
    }
    const result = await pool.query(
      'UPDATE users SET is_active = NOT is_active WHERE user_id = $1 RETURNING username, is_active',
      [targetId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    const u = result.rows[0];
    res.json({ message: `Đã ${u.is_active ? 'mở khóa' : 'khóa'} tài khoản "${u.username}".` });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thay đổi trạng thái tài khoản.' });
  }
});

module.exports = router;

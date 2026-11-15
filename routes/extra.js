const express = require('express');
const pool = require('../db');

const router = express.Router();

function genDocNo(prefix) {
  return `${prefix}-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này.' });
    }
    next();
  };
}

// ============================================================================
// 1. SỔ QUỸ THU - CHI & CÔNG NỢ (PAYMENTS)
// ============================================================================
router.get('/payments', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const type = (req.query.type || '').trim();
    const method = (req.query.method || '').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();

    const params = [q];
    const where = ['(pm.payment_no ILIKE $1 OR COALESCE(pm.notes, \'\') ILIKE $1 OR u.full_name ILIKE $1)'];

    if (type) {
      params.push(type);
      where.push(`pm.payment_type = $${params.length}`);
    }
    if (method) {
      params.push(method);
      where.push(`pm.payment_method = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`DATE(pm.payment_date) >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`DATE(pm.payment_date) <= $${params.length}`);
    }

    const [rowsRes, debtRes] = await Promise.all([
      pool.query(
        `SELECT pm.*, u.full_name AS staff_name, i.invoice_no, pr.receipt_no
         FROM payments pm
         JOIN users u ON pm.user_id = u.user_id
         LEFT JOIN invoices i ON pm.invoice_id = i.invoice_id
         LEFT JOIN purchase_receipts pr ON pm.receipt_id = pr.receipt_id
         WHERE ${where.join(' AND ')}
         ORDER BY pm.payment_date DESC`,
        params
      ),
      pool.query(`
        SELECT
          (SELECT COALESCE(SUM(debt_amount), 0) FROM customers) AS total_receivable,
          (SELECT COALESCE(SUM(payable_balance), 0) FROM suppliers) AS total_payable
      `),
    ]);

    res.json({
      payments: rowsRes.rows,
      debtSummary: debtRes.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải sổ quỹ Thu - Chi.' });
  }
});

router.post('/payments', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    const { payment_type, amount, payment_method, notes } = req.body;
    const amt = Number(amount);
    if (!['Thu', 'Chi'].includes(payment_type) || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Loại phiếu phải là Thu/Chi và số tiền > 0.' });
    }

    const prefix = payment_type === 'Thu' ? 'PT-' : 'PC-';
    const payNo = prefix + Date.now().toString().slice(-8);
    const result = await pool.query(
      `INSERT INTO payments (payment_no, payment_type, user_id, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [payNo, payment_type, req.session.user.user_id, amt, payment_method || 'TienMat', (notes || '').trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lập phiếu Thu / Chi.' });
  }
});

// ============================================================================
// 2. BẢO HÀNH LINH KIỆN THEO SERIAL (WARRANTY & RMA)
// ============================================================================
router.get('/warranty', requireRole('Admin', 'BanHang', 'ThuKho'), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const status = (req.query.status || '').trim();

    const params = [q];
    const where = [
      `(ws.serial_number ILIKE $1 OR p.sku ILIKE $1 OR p.product_name ILIKE $1 OR COALESCE(i.invoice_no, '') ILIKE $1 OR COALESCE(c.customer_name, '') ILIKE $1 OR COALESCE(c.phone, '') ILIKE $1)`,
    ];
    if (status) {
      params.push(status);
      where.push(`ws.status = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT ws.serial_id, ws.serial_number, ws.status, ws.created_at,
              p.product_id, p.sku, p.product_name, p.warranty_months,
              pr.receipt_no,
              i.invoice_no, i.invoice_date,
              (i.invoice_date + (p.warranty_months || ' months')::INTERVAL) AS warranty_end,
              c.customer_name, c.phone AS customer_phone
       FROM warranty_serials ws
       JOIN products p ON ws.product_id = p.product_id
       LEFT JOIN purchase_receipts pr ON ws.receipt_id = pr.receipt_id
       LEFT JOIN invoices i ON ws.invoice_id = i.invoice_id
       LEFT JOIN customers c ON i.customer_id = c.customer_id
       WHERE ${where.join(' AND ')}
       ORDER BY ws.serial_id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách bảo hành Serial.' });
  }
});

router.put('/warranty/:id/status', requireRole('Admin', 'BanHang', 'ThuKho'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    if (!['TrongKho', 'DaBan', 'BaoHanh'].includes(status)) {
      return res.status(400).json({ error: 'Trạng thái bảo hành không hợp lệ.' });
    }

    await client.query('BEGIN');
    const wsRes = await client.query('SELECT * FROM warranty_serials WHERE serial_id = $1 FOR UPDATE', [req.params.id]);
    if (wsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy Serial.' });
    }
    const ws = wsRes.rows[0];

    const isRmaRestock = ws.status === 'BaoHanh' && status === 'TrongKho' && ws.invoice_id === null;
    const isReturnToCustomer = ws.status === 'BaoHanh' && status === 'DaBan' && ws.invoice_id !== null;
    const isReceiveWarranty = ws.status === 'DaBan' && status === 'BaoHanh' && ws.invoice_id !== null;

    if (!isRmaRestock && !isReturnToCustomer && !isReceiveWarranty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Không thể chuyển trạng thái Serial từ "${ws.status}" sang "${status}" (${ws.invoice_id === null ? 'hàng kho/trả lỗi' : 'hàng đã bán cho khách'}).`,
      });
    }

    const updated = await client.query(
      'UPDATE warranty_serials SET status = $1 WHERE serial_id = $2 RETURNING *',
      [status, ws.serial_id]
    );

    if (isRmaRestock) {
      const prodRes = await client.query(
        'UPDATE products SET stock_qty = stock_qty + 1 WHERE product_id = $1 RETURNING stock_qty',
        [ws.product_id]
      );
      const newStock = Number(prodRes.rows[0].stock_qty);
      const adjNo = genDocNo('BH');
      await client.query(
        `INSERT INTO stock_adjustments (adjustment_no, product_id, user_id, system_qty, actual_qty, diff_qty, reason)
         VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [adjNo, ws.product_id, req.session.user.user_id, newStock - 1, newStock, `Nhập lại kho sau bảo hành hãng (S/N: ${ws.serial_number})`]
      );
    }

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Lỗi cập nhật trạng thái bảo hành.' });
  } finally {
    client.release();
  }
});

// ============================================================================
// 3. BÁO CÁO THỐNG KÊ KẾ TOÁN (REPORTS)
// ============================================================================
router.get('/reports', requireRole('Admin', 'KeToan'), async (req, res) => {
  try {
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();

    const invParams = [];
    const recParams = [];
    const invConds = ["i.payment_status NOT IN ('DaHuy', 'DaDoiTra', 'ChoTraHang')"];
    const recConds = ['1=1'];

    if (from) {
      invParams.push(from);
      invConds.push(`DATE(i.invoice_date) >= $${invParams.length}`);
      recParams.push(from);
      recConds.push(`DATE(pr.receipt_date) >= $${recParams.length}`);
    }
    if (to) {
      invParams.push(to);
      invConds.push(`DATE(i.invoice_date) <= $${invParams.length}`);
      recParams.push(to);
      recConds.push(`DATE(pr.receipt_date) <= $${recParams.length}`);
    }

    const invWhere = invConds.join(' AND ');
    const recWhere = recConds.join(' AND ');

    const [revRes, cogsRes, purRes, stockRes, topRes, debtCustRes, debtSupRes, dailyTrendRes, catRevRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(i.subtotal), 0) AS subtotal,
                COALESCE(SUM(i.vat_amount), 0) AS vat_total,
                COALESCE(SUM(i.total_amount), 0) AS revenue,
                COALESCE(SUM(i.paid_amount), 0) AS collected,
                COUNT(*) AS invoice_count
         FROM invoices i WHERE ${invWhere}`,
        invParams
      ),
      pool.query(
        `SELECT COALESCE(SUM(id.quantity * p.import_price), 0) AS cogs
         FROM invoice_details id
         JOIN invoices i ON id.invoice_id = i.invoice_id
         JOIN products p ON id.product_id = p.product_id
         WHERE ${invWhere}`,
        invParams
      ),
      pool.query(
        `SELECT COALESCE(SUM(pr.total_amount), 0) AS purchase_total,
                COALESCE(SUM(pr.paid_amount), 0) AS purchase_paid,
                COUNT(*) AS receipt_count
         FROM purchase_receipts pr WHERE ${recWhere}`,
        recParams
      ),
      pool.query(`
        SELECT COALESCE(SUM(stock_qty * import_price), 0) AS inventory_value,
               COALESCE(SUM(stock_qty), 0) AS total_units,
               COUNT(*) AS total_sku,
               COUNT(*) FILTER (WHERE stock_qty > min_stock) AS safe_sku,
               (SELECT COALESCE(SUM(debt_amount), 0) FROM customers) AS total_receivable,
               (SELECT COALESCE(SUM(payable_balance), 0) FROM suppliers) AS total_payable
        FROM products
      `),
      pool.query(
        `SELECT p.sku, p.product_name,
                SUM(id.quantity)::INT AS qty_sold,
                SUM(id.line_total) AS revenue,
                SUM(id.line_total - id.quantity * p.import_price) AS profit
         FROM invoice_details id
         JOIN invoices i ON id.invoice_id = i.invoice_id
         JOIN products p ON id.product_id = p.product_id
         WHERE ${invWhere}
         GROUP BY p.product_id, p.sku, p.product_name
         ORDER BY qty_sold DESC, revenue DESC
         LIMIT 10`,
        invParams
      ),
      pool.query(`
        SELECT customer_id, customer_name, phone, customer_group, credit_limit, debt_amount
        FROM customers WHERE debt_amount > 0 ORDER BY debt_amount DESC
      `),
      pool.query(`
        SELECT supplier_id, supplier_name, phone, tax_code, payable_balance
        FROM suppliers WHERE payable_balance > 0 ORDER BY payable_balance DESC
      `),
      pool.query(
        `SELECT TO_CHAR(DATE(i.invoice_date), 'DD/MM') AS day_label,
                DATE(i.invoice_date) AS day_date,
                COALESCE(SUM(i.total_amount), 0) AS revenue,
                COALESCE(SUM(i.paid_amount), 0) AS collected
         FROM invoices i
         WHERE ${invWhere}
         GROUP BY DATE(i.invoice_date)
         ORDER BY DATE(i.invoice_date) ASC`,
        invParams
      ),
      pool.query(
        `SELECT c.category_name,
                COALESCE(SUM(id.line_total), 0) AS revenue,
                COALESCE(SUM(id.quantity), 0)::INT AS qty
         FROM invoice_details id
         JOIN invoices i ON id.invoice_id = i.invoice_id
         JOIN products p ON id.product_id = p.product_id
         JOIN categories c ON p.category_id = c.category_id
         WHERE ${invWhere}
         GROUP BY c.category_id, c.category_name
         ORDER BY revenue DESC`,
        invParams
      ),
    ]);

    const rev = revRes.rows[0];
    const cogs = Number(cogsRes.rows[0].cogs || 0);
    const grossProfit = Number(rev.subtotal || 0) - cogs;

    res.json({
      summary: {
        ...rev,
        cogs,
        gross_profit: grossProfit,
        ...purRes.rows[0],
        ...stockRes.rows[0],
      },
      topProducts: topRes.rows,
      debtCustomers: debtCustRes.rows,
      debtSuppliers: debtSupRes.rows,
      dailyTrend: dailyTrendRes.rows,
      categoryRevenue: catRevRes.rows,
    });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Lỗi tổng hợp báo cáo thống kê.' });
  }
});

module.exports = router;

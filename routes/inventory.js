const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  next();
}

// Xem tồn kho hiện tại + lọc theo trạng thái
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const status = req.query.status || 'all';

    let sql = `
      SELECT p.product_id, p.sku, p.product_name, p.unit, p.stock_qty, p.min_stock,
             p.import_price, p.sale_price, p.shelf_location, c.category_name
      FROM products p
      JOIN categories c ON p.category_id = c.category_id
      WHERE (p.sku ILIKE $1 OR p.product_name ILIKE $1 OR COALESCE(p.shelf_location, '') ILIKE $1)
    `;

    if (status === 'low') {
      sql += ' AND p.stock_qty > 0 AND p.stock_qty <= p.min_stock';
    } else if (status === 'out') {
      sql += ' AND p.stock_qty = 0';
    }

    sql += ' ORDER BY p.stock_qty ASC, p.product_name ASC';
    const result = await pool.query(sql, [q]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải dữ liệu tồn kho.' });
  }
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác kho này.' });
    }
    next();
  };
}

// Lịch sử biến động Nhập - Xuất - Kiểm kho (Thẻ kho kèm Tồn sau GD)
router.get('/movements', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM (
        SELECT 'NHAP' AS move_type, pr.receipt_no AS doc_no, pr.receipt_date AS move_date,
               p.product_id, p.sku, p.product_name, p.stock_qty AS current_stock,
               pd.quantity AS qty_change, u.full_name AS staff_name, pr.notes AS note
        FROM purchase_details pd
        JOIN purchase_receipts pr ON pd.receipt_id = pr.receipt_id
        JOIN products p ON pd.product_id = p.product_id
        JOIN users u ON pr.user_id = u.user_id
        WHERE pr.warehouse_status = 'DaNhapKho'
        UNION ALL
        SELECT 'XUAT' AS move_type, i.invoice_no AS doc_no, i.invoice_date AS move_date,
               p.product_id, p.sku, p.product_name, p.stock_qty AS current_stock,
               -id.quantity AS qty_change, u.full_name AS staff_name, i.notes AS note
        FROM invoice_details id
        JOIN invoices i ON id.invoice_id = i.invoice_id
        JOIN products p ON id.product_id = p.product_id
        JOIN users u ON i.user_id = u.user_id
        WHERE i.payment_status <> 'DaHuy'
          AND NOT (i.payment_status = 'DaDoiTra' AND COALESCE(i.notes, '') NOT LIKE '%Kho xác nhận hàng LỖI%')
        UNION ALL
        SELECT 'KIEMKHO' AS move_type, sa.adjustment_no AS doc_no, sa.adjusted_at AS move_date,
               p.product_id, p.sku, p.product_name, p.stock_qty AS current_stock,
               sa.diff_qty AS qty_change, u.full_name AS staff_name, sa.reason AS note
        FROM stock_adjustments sa
        JOIN products p ON sa.product_id = p.product_id
        JOIN users u ON sa.user_id = u.user_id
      ) AS movements
      ORDER BY move_date DESC
      LIMIT 50
    `);

    // Tính "Tồn sau GD" (running balance) ngược từ tồn hiện tại của từng sản phẩm
    const runningByProd = new Map();
    const enriched = result.rows.map((m) => {
      const pid = m.product_id;
      if (!runningByProd.has(pid)) {
        runningByProd.set(pid, Number(m.current_stock));
      }
      const balanceAfter = runningByProd.get(pid);
      runningByProd.set(pid, balanceAfter - Number(m.qty_change));
      return { ...m, balance_after: balanceAfter };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải lịch sử biến động kho.' });
  }
});

// Danh sách phiếu kiểm kho (Stocktake)
router.get('/adjustments', requireRole('Admin', 'ThuKho', 'KeToan'), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const result = await pool.query(
      `SELECT sa.*, p.sku, p.product_name, p.unit, u.full_name AS staff_name
       FROM stock_adjustments sa
       JOIN products p ON sa.product_id = p.product_id
       JOIN users u ON sa.user_id = u.user_id
       WHERE sa.adjustment_no ILIKE $1 OR p.sku ILIKE $1 OR p.product_name ILIKE $1 OR COALESCE(sa.reason, '') ILIKE $1
       ORDER BY sa.adjusted_at DESC`,
      [q]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách phiếu kiểm kho.' });
  }
});

// Lập phiếu kiểm kho / Cân bằng tồn kho (Stocktake)
router.post('/adjust', requireRole('Admin', 'ThuKho', 'KeToan'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { product_id, actual_qty, reason } = req.body;
    const actual = Number(actual_qty);
    if (!product_id || !Number.isInteger(actual) || actual < 0) {
      return res.status(400).json({ error: 'Số lượng kiểm đếm thực tế phải là số nguyên >= 0.' });
    }

    await client.query('BEGIN');
    const prodRes = await client.query(
      'SELECT product_id, product_name, stock_qty FROM products WHERE product_id = $1 FOR UPDATE',
      [Number(product_id)]
    );
    if (prodRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    }

    const prod = prodRes.rows[0];
    const systemQty = Number(prod.stock_qty);
    const diffQty = actual - systemQty;
    const adjNo = 'KK-' + Date.now().toString().slice(-8);

    const adjRes = await client.query(
      `INSERT INTO stock_adjustments (adjustment_no, product_id, user_id, system_qty, actual_qty, diff_qty, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [adjNo, prod.product_id, req.session.user.user_id, systemQty, actual, diffQty, (reason || 'Kiểm kê định kỳ').trim()]
    );

    await client.query('UPDATE products SET stock_qty = $1 WHERE product_id = $2', [actual, prod.product_id]);
    await client.query('COMMIT');
    res.status(201).json(adjRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Lỗi lập phiếu kiểm kho.' });
  } finally {
    client.release();
  }
});

// Chuyển vị trí kệ kho nhanh (Move Shelf)
router.put('/move-shelf', requireRole('Admin', 'ThuKho'), async (req, res) => {
  try {
    const { product_id, shelf_location } = req.body;
    if (!product_id || !String(shelf_location || '').trim()) {
      return res.status(400).json({ error: 'Vui lòng chọn sản phẩm và vị trí kệ mới.' });
    }
    const result = await pool.query(
      'UPDATE products SET shelf_location = $1 WHERE product_id = $2 RETURNING product_id, sku, product_name, shelf_location',
      [String(shelf_location).trim(), Number(product_id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi chuyển vị trí kệ.' });
  }
});

module.exports = router;

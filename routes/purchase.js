const express = require('express');
const pool = require('../db');

const router = express.Router();

function genDocNo(prefix) {
  return `${prefix}-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;
}

function parseUniqueSerials(rawSerials, maxQty) {
  const parts = Array.isArray(rawSerials)
    ? rawSerials
    : String(rawSerials || '').split(/[\n,;]+/);
  const nonEmpty = parts.map((s) => String(s || '').trim()).filter(Boolean);
  const cleanSerials = [...new Set(nonEmpty)];
  if (cleanSerials.length !== nonEmpty.length) {
    const e = new Error('Danh sách Serial bị trùng lặp.');
    e.status = 400;
    throw e;
  }
  if (cleanSerials.length > maxQty) {
    const e = new Error(`Số lượng Serial (${cleanSerials.length}) vượt quá số lượng nhập cho phép (${maxQty}).`);
    e.status = 400;
    throw e;
  }
  return cleanSerials;
}

async function insertReceiptSerials(client, receiptId, productId, snList) {
  for (const sn of snList) {
    await client.query(
      `INSERT INTO warranty_serials (product_id, receipt_id, serial_number, status)
       VALUES ($1, $2, $3, 'TrongKho')`,
      [productId, receiptId, sn]
    );
  }
}

async function applyStockAndWeightedCost(client, productId, qty, importPrice, shelfLocation = null) {
  const setShelf = shelfLocation ? ', shelf_location = $4' : '';
  const params = shelfLocation ? [qty, importPrice, productId, shelfLocation] : [qty, importPrice, productId];
  await client.query(
    `UPDATE products
     SET import_price = CASE
       WHEN stock_qty + $1 > 0 THEN ROUND((stock_qty * import_price + $1::numeric * $2::numeric) / (stock_qty + $1))
       ELSE $2::numeric
     END,
     stock_qty = stock_qty + $1${setShelf}
     WHERE product_id = $3`,
    params
  );
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập phân hệ Mua hàng.' });
    }
    next();
  };
}

// Danh sách phiếu nhập (lọc theo từ khóa, khoảng ngày, phiếu chưa thanh toán đủ)
router.get('/', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const fromDate = req.query.from_date;
    const toDate = req.query.to_date;
    const unpaidOnly = req.query.unpaid_only === 'true';

    let sql = `
      SELECT pr.*, s.supplier_name, u.full_name AS staff_name
      FROM purchase_receipts pr
      JOIN suppliers s ON pr.supplier_id = s.supplier_id
      JOIN users u ON pr.user_id = u.user_id
      WHERE (pr.receipt_no ILIKE $1 OR s.supplier_name ILIKE $1 OR COALESCE(pr.supplier_invoice_no, '') ILIKE $1)
    `;
    const params = [q];
    if (fromDate) {
      params.push(fromDate);
      sql += ` AND DATE(pr.receipt_date) >= $${params.length}`;
    }
    if (toDate) {
      params.push(toDate);
      sql += ` AND DATE(pr.receipt_date) <= $${params.length}`;
    }
    if (unpaidOnly) {
      sql += ' AND pr.total_amount > pr.paid_amount';
    }
    sql += ' ORDER BY pr.receipt_date DESC';

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách phiếu nhập.' });
  }
});

// Chi tiết 1 phiếu nhập (kèm danh sách Serial bảo hành đã nhập)
router.get('/:id', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  try {
    const header = await pool.query(
      `SELECT pr.*, s.supplier_name, s.phone AS supplier_phone, s.address AS supplier_address, u.full_name AS staff_name
       FROM purchase_receipts pr
       JOIN suppliers s ON pr.supplier_id = s.supplier_id
       JOIN users u ON pr.user_id = u.user_id
       WHERE pr.receipt_id = $1`,
      [req.params.id]
    );
    if (header.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập.' });

    const [details, serials] = await Promise.all([
      pool.query(
        `SELECT pd.*, p.sku, p.product_name, p.unit, p.shelf_location
         FROM purchase_details pd
         JOIN products p ON pd.product_id = p.product_id
         WHERE pd.receipt_id = $1`,
        [req.params.id]
      ),
      pool.query(
        `SELECT ws.*, p.sku, p.product_name
         FROM warranty_serials ws
         JOIN products p ON ws.product_id = p.product_id
         WHERE ws.receipt_id = $1
         ORDER BY ws.serial_id ASC`,
        [req.params.id]
      ),
    ]);
    res.json({ ...header.rows[0], items: details.rows, serials: serials.rows });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải chi tiết phiếu nhập.' });
  }
});

// Lập phiếu nhập mới (Transaction: lưu phiếu + nhiều dòng + Serial + cộng tồn kho nếu DaNhapKho)
router.post('/', requireRole('Admin', 'KeToan', 'ThuKho'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { supplier_id, supplier_invoice_no, warehouse_status, paid_amount, payment_method, notes, items } = req.body;

    if (!supplier_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Vui lòng chọn Nhà cung cấp và thêm ít nhất 1 sản phẩm.' });
    }

    let totalAmount = 0;
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.import_price);
      if (!item.product_id || !Number.isInteger(qty) || qty <= 0 || isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Số lượng phải > 0 và đơn giá nhập không được âm.' });
      }
      totalAmount += qty * price;
    }

    const paid = Math.max(0, Number(paid_amount || 0));
    if (paid > totalAmount) {
      return res.status(400).json({ error: 'Số tiền thanh toán không được vượt quá tổng tiền phiếu nhập.' });
    }

    const whStatus = warehouse_status === 'ChoNhapKho' ? 'ChoNhapKho' : 'DaNhapKho';
    const paymentMethod = ['TienMat', 'ChuyenKhoan', 'QuetThe'].includes(payment_method)
      ? payment_method
      : 'ChuyenKhoan';

    const parsedItems = items.map((item) => {
      const qty = Number(item.quantity);
      const price = Number(item.import_price);
      const serials = parseUniqueSerials(item.serials, qty);
      return {
        product_id: Number(item.product_id),
        qty,
        price,
        lineTotal: qty * price,
        serials,
      };
    });

    await client.query('BEGIN');

    const receiptNo = genDocNo('PN');
    const receiptRes = await client.query(
      `INSERT INTO purchase_receipts (receipt_no, supplier_invoice_no, supplier_id, user_id, total_amount, paid_amount, warehouse_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        receiptNo,
        (supplier_invoice_no || '').trim() || null,
        Number(supplier_id),
        req.session.user.user_id,
        totalAmount,
        paid,
        whStatus,
        (notes || '').trim(),
      ]
    );
    const receipt = receiptRes.rows[0];

    for (const item of parsedItems) {
      await client.query(
        `INSERT INTO purchase_details (receipt_id, product_id, quantity, import_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [receipt.receipt_id, item.product_id, item.qty, item.price, item.lineTotal]
      );

      // Nếu đã nhập kho ngay thì cộng tồn kho & tính giá vốn bình quân gia quyền; nếu ChoNhapKho thì chờ Thủ kho duyệt
      if (whStatus === 'DaNhapKho') {
        await applyStockAndWeightedCost(client, item.product_id, item.qty, item.price);
      }

      // Lưu danh sách Serial nếu có nhập
      if (item.serials.length > 0) {
        await insertReceiptSerials(client, receipt.receipt_id, item.product_id, item.serials);
      }
    }

    const debt = totalAmount - paid;
    if (debt > 0) {
      await client.query(
        'UPDATE suppliers SET payable_balance = payable_balance + $1 WHERE supplier_id = $2',
        [debt, Number(supplier_id)]
      );
    }

    if (paid > 0) {
      const payNo = genDocNo('PC');
      await client.query(
        `INSERT INTO payments (payment_no, payment_type, receipt_id, user_id, amount, payment_method, notes)
         VALUES ($1, 'Chi', $2, $3, $4, $5, $6)`,
        [payNo, receipt.receipt_id, req.session.user.user_id, paid, paymentMethod, `Thanh toán phiếu nhập ${receiptNo}`]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(receipt);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Mã Serial (S/N) bị trùng với một linh kiện đã có trong kho.' });
    }
    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Lỗi lưu phiếu nhập kho: ' + err.message });
  } finally {
    client.release();
  }
});

// Thủ kho / Admin duyệt xác nhận đã kiểm đếm nhập kho
router.post('/:id/confirm-warehouse', requireRole('Admin', 'ThuKho'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recRes = await client.query('SELECT * FROM purchase_receipts WHERE receipt_id = $1 FOR UPDATE', [req.params.id]);
    if (recRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy phiếu nhập.' });
    }
    const rec = recRes.rows[0];
    if (rec.warehouse_status === 'DaNhapKho') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Phiếu nhập này đã được xác nhận nhập kho trước đó.' });
    }

    const shelfMap = new Map();
    if (Array.isArray(req.body?.shelf_assignments)) {
      for (const a of req.body.shelf_assignments) {
        if (a && a.product_id && a.shelf_location) {
          shelfMap.set(Number(a.product_id), String(a.shelf_location).trim());
        }
      }
    }

    const details = await client.query('SELECT product_id, quantity, import_price FROM purchase_details WHERE receipt_id = $1', [rec.receipt_id]);

    // Tính tổng SL theo sản phẩm để đối chiếu với Serial bổ sung khi Thủ kho kiểm đếm
    const qtyByProd = new Map();
    for (const d of details.rows) {
      const pid = Number(d.product_id);
      qtyByProd.set(pid, (qtyByProd.get(pid) || 0) + Number(d.quantity));
    }

    if (Array.isArray(req.body?.serial_assignments)) {
      const existingSnRes = await client.query(
        'SELECT product_id, COUNT(*)::int AS cnt FROM warranty_serials WHERE receipt_id = $1 GROUP BY product_id',
        [rec.receipt_id]
      );
      const existingByProd = new Map(existingSnRes.rows.map((r) => [Number(r.product_id), r.cnt]));
      const seenBatchSerials = new Set();

      for (const sa of req.body.serial_assignments) {
        if (!sa || !sa.product_id || !sa.serials) continue;
        const pid = Number(sa.product_id);
        const maxQty = (qtyByProd.get(pid) || 0) - (existingByProd.get(pid) || 0);
        if (!qtyByProd.has(pid)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Sản phẩm gán Serial không nằm trong phiếu nhập này.' });
        }
        const snList = parseUniqueSerials(sa.serials, Math.max(0, maxQty));
        for (const sn of snList) {
          if (seenBatchSerials.has(sn)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Mã Serial "${sn}" bị lặp lại trong phiếu nhập.` });
          }
          seenBatchSerials.add(sn);
        }
        if (snList.length > 0) {
          await insertReceiptSerials(client, rec.receipt_id, pid, snList);
          existingByProd.set(pid, (existingByProd.get(pid) || 0) + snList.length);
        }
      }
    }

    for (const d of details.rows) {
      const assignedShelf = shelfMap.get(Number(d.product_id)) || null;
      await applyStockAndWeightedCost(client, Number(d.product_id), Number(d.quantity), Number(d.import_price), assignedShelf);
    }

    await client.query("UPDATE purchase_receipts SET warehouse_status = 'DaNhapKho' WHERE receipt_id = $1", [rec.receipt_id]);
    await client.query('COMMIT');
    res.json({ message: `Đã xác nhận nhập kho phiếu ${rec.receipt_no} và cộng tồn kho thành công!` });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Mã Serial (S/N) bị trùng với một linh kiện đã có trong kho.' });
    }
    res.status(500).json({ error: 'Lỗi xác nhận nhập kho.' });
  } finally {
    client.release();
  }
});

// Kế toán / Admin thanh toán phần còn nợ cho 1 phiếu nhập cụ thể
router.post('/:id/pay', requireRole('Admin', 'KeToan'), async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount || 0);
    const paymentMethod = ['TienMat', 'ChuyenKhoan', 'QuetThe'].includes(req.body.payment_method)
      ? req.body.payment_method
      : 'ChuyenKhoan';
    const notes = (req.body.notes || '').trim();

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Số tiền thanh toán phải lớn hơn 0.' });
    }

    await client.query('BEGIN');

    const recRes = await client.query('SELECT * FROM purchase_receipts WHERE receipt_id = $1 FOR UPDATE', [req.params.id]);
    if (recRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy phiếu nhập.' });
    }
    const rec = recRes.rows[0];
    const remainingDebt = Number(rec.total_amount) - Number(rec.paid_amount);
    if (remainingDebt <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Phiếu nhập này đã thanh toán đủ.' });
    }
    if (amount > remainingDebt) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Số tiền trả (${amount.toLocaleString('vi-VN')} ₫) vượt quá số nợ còn lại (${remainingDebt.toLocaleString('vi-VN')} ₫).`,
      });
    }

    await client.query('UPDATE purchase_receipts SET paid_amount = paid_amount + $1 WHERE receipt_id = $2', [amount, rec.receipt_id]);
    await client.query('UPDATE suppliers SET payable_balance = GREATEST(0, payable_balance - $1) WHERE supplier_id = $2', [
      amount,
      rec.supplier_id,
    ]);

    const payNo = genDocNo('PC');
    await client.query(
      `INSERT INTO payments (payment_no, payment_type, receipt_id, user_id, amount, payment_method, notes)
       VALUES ($1, 'Chi', $2, $3, $4, $5, $6)`,
      [payNo, rec.receipt_id, req.session.user.user_id, amount, paymentMethod, notes || `Thanh toán nợ phiếu nhập ${rec.receipt_no}`]
    );

    await client.query('COMMIT');
    res.json({
      message: `Đã lập phiếu chi ${payNo} trả ${amount.toLocaleString('vi-VN')} ₫ cho phiếu nhập ${rec.receipt_no}.`,
      payment_no: payNo,
      remaining_debt: remainingDebt - amount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Lỗi thanh toán phiếu nhập.' });
  } finally {
    client.release();
  }
});

module.exports = router;

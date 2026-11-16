const express = require('express');
const pool = require('../db');

const router = express.Router();

function genDocNo(prefix) {
  return `${prefix}-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 90)}`;
}

async function assignSerialsToInvoiceLine(client, invoiceId, productId, maxQty, rawSerials) {
  const nonEmpty = (rawSerials || []).map((s) => String(s || '').trim()).filter(Boolean);
  const cleanSerials = [...new Set(nonEmpty)];
  if (cleanSerials.length !== nonEmpty.length) {
    const e = new Error('Danh sách Serial xuất bán có mã bị trùng lặp.');
    e.status = 400;
    throw e;
  }
  if (cleanSerials.length > maxQty) {
    const e = new Error(`Số lượng Serial (${cleanSerials.length}) vượt quá số lượng bán (${maxQty}).`);
    e.status = 400;
    throw e;
  }
  for (const sn of cleanSerials) {
    const existingSn = await client.query(
      `SELECT ws.serial_id, ws.product_id, ws.status, ws.invoice_id, ws.receipt_id, pr.warehouse_status
       FROM warranty_serials ws
       LEFT JOIN purchase_receipts pr ON ws.receipt_id = pr.receipt_id
       WHERE ws.serial_number = $1 FOR UPDATE OF ws`,
      [sn]
    );
    if (existingSn.rows.length > 0) {
      const row = existingSn.rows[0];
      if (row.product_id !== productId) {
        const e = new Error(`Serial "${sn}" không thuộc sản phẩm này.`);
        e.status = 400;
        throw e;
      }
      if (row.status === 'DaBan' && row.invoice_id === invoiceId) {
        continue;
      }
      if (row.status !== 'TrongKho') {
        const e = new Error(`Serial "${sn}" đã xuất bán hoặc đang bảo hành.`);
        e.status = 400;
        throw e;
      }
      if (row.receipt_id && row.warehouse_status !== 'DaNhapKho') {
        const e = new Error(`Serial "${sn}" thuộc phiếu nhập chưa được Thủ kho duyệt nhập kho.`);
        e.status = 400;
        throw e;
      }
      await client.query(
        `UPDATE warranty_serials SET status = 'DaBan', invoice_id = $1 WHERE serial_id = $2`,
        [invoiceId, row.serial_id]
      );
    } else {
      await client.query(
        `INSERT INTO warranty_serials (product_id, invoice_id, serial_number, status)
         VALUES ($1, $2, $3, 'DaBan')`,
        [productId, invoiceId, sn]
      );
    }
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập phân hệ Bán hàng.' });
    }
    next();
  };
}

// Danh sách hóa đơn (Hỗ trợ lọc theo từ khóa, khoảng ngày, trạng thái thanh toán)
router.get('/', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    const status = (req.query.status || '').trim();

    const params = [q];
    const where = ['(i.invoice_no ILIKE $1 OR c.customer_name ILIKE $1 OR c.phone ILIKE $1 OR u.full_name ILIKE $1)'];

    if (from) {
      params.push(from);
      where.push(`DATE(i.invoice_date) >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`DATE(i.invoice_date) <= $${params.length}`);
    }
    if (status === 'debt') {
      where.push(`i.debt_amount > 0 AND i.payment_status IN ('GhiNo', 'ThanhToanMotPhan')`);
    } else if (status === 'pending') {
      where.push(`i.payment_status = 'ChoThanhToan'`);
    } else if (status === 'pending_return') {
      where.push(`i.payment_status = 'ChoTraHang'`);
    } else if (status === 'paid') {
      where.push(`i.payment_status = 'DaThanhToan'`);
    } else if (status === 'cancelled') {
      where.push(`i.payment_status IN ('DaHuy', 'DaDoiTra')`);
    }

    const result = await pool.query(
      `SELECT i.*, c.customer_name, c.phone AS customer_phone, u.full_name AS staff_name,
              EXISTS (SELECT 1 FROM payments pm WHERE pm.invoice_id = i.invoice_id AND pm.payment_type = 'Chi') AS has_refund
       FROM invoices i
       JOIN customers c ON i.customer_id = c.customer_id
       JOIN users u ON i.user_id = u.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.invoice_date DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách hóa đơn.' });
  }
});

// Danh sách hóa đơn đang Chờ Kho kiểm nhận trả hàng (ChoTraHang)
router.get('/pending-returns', requireRole('Admin', 'ThuKho', 'KeToan'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, c.customer_name, c.phone AS customer_phone, u.full_name AS staff_name
       FROM invoices i
       JOIN customers c ON i.customer_id = c.customer_id
       JOIN users u ON i.user_id = u.user_id
       WHERE i.payment_status = 'ChoTraHang'
       ORDER BY i.invoice_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách đơn chờ kiểm nhận trả hàng.' });
  }
});

// Lấy danh sách Serial đang có TrongKho (chỉ lấy hàng đã nhập kho lên kệ) để chọn khi xuất bán
router.get('/available-serials', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ws.serial_id, ws.product_id, ws.serial_number
       FROM warranty_serials ws
       LEFT JOIN purchase_receipts pr ON ws.receipt_id = pr.receipt_id
       WHERE ws.status = 'TrongKho'
         AND (ws.receipt_id IS NULL OR pr.warehouse_status = 'DaNhapKho')
       ORDER BY ws.product_id, ws.serial_id`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách Serial trong kho.' });
  }
});

// Chi tiết 1 hóa đơn (kèm thông tin bảo hành và Serial đã xuất)
router.get('/:id', requireRole('Admin', 'KeToan', 'BanHang', 'ThuKho'), async (req, res) => {
  try {
    const header = await pool.query(
      `SELECT i.*, c.customer_name, c.phone AS customer_phone, c.address AS customer_address, c.tax_code AS customer_tax_code, u.full_name AS staff_name
       FROM invoices i
       JOIN customers c ON i.customer_id = c.customer_id
       JOIN users u ON i.user_id = u.user_id
       WHERE i.invoice_id = $1`,
      [req.params.id]
    );
    if (header.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy hóa đơn.' });

    const [details, serials] = await Promise.all([
      pool.query(
        `SELECT id.*, p.sku, p.product_name, p.unit, p.warranty_months, p.shelf_location
         FROM invoice_details id
         JOIN products p ON id.product_id = p.product_id
         WHERE id.invoice_id = $1`,
        [req.params.id]
      ),
      pool.query(
        `SELECT product_id, serial_number
         FROM warranty_serials
         WHERE invoice_id = $1
         ORDER BY serial_id`,
        [req.params.id]
      ),
    ]);

    const serialsByProd = {};
    for (const s of serials.rows) {
      if (!serialsByProd[s.product_id]) serialsByProd[s.product_id] = [];
      serialsByProd[s.product_id].push(s.serial_number);
    }

    const itemsWithSerials = details.rows.map((it) => ({
      ...it,
      serials: serialsByProd[it.product_id] || [],
    }));

    res.json({ ...header.rows[0], items: itemsWithSerials });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải chi tiết hóa đơn.' });
  }
});

// Lập hóa đơn bán hàng (Transaction: kiểm tra KHÔNG xuất vượt tồn + trừ kho + ghi nhận thanh toán/công nợ)
router.post('/', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer_id, vat_rate, paid_amount, payment_method, notes, items } = req.body;

    if (!customer_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Vui lòng chọn Khách hàng và thêm ít nhất 1 sản phẩm.' });
    }

    // Gộp các dòng trùng sản phẩm (nếu cùng đơn giá) hoặc báo lỗi nếu khác đơn giá
    const mergedMap = new Map();
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const pid = Number(item.product_id);
      if (!pid || !Number.isInteger(qty) || qty <= 0 || isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Số lượng bán phải là số nguyên > 0 và đơn giá >= 0.' });
      }
      const serials = Array.isArray(item.serials)
        ? item.serials.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      if (mergedMap.has(pid)) {
        const existing = mergedMap.get(pid);
        if (existing.unit_price !== price) {
          return res.status(400).json({
            error: 'Không được chọn trùng cùng 1 sản phẩm với đơn giá khác nhau trên cùng hóa đơn.',
          });
        }
        existing.quantity += qty;
        existing.serials.push(...serials);
      } else {
        mergedMap.set(pid, { product_id: pid, quantity: qty, unit_price: price, serials });
      }
    }
    const mergedItems = Array.from(mergedMap.values());

    await client.query('BEGIN');

    // Khóa dòng sản phẩm, kiểm tra trạng thái kinh doanh, giá vốn & không cho xuất vượt tồn
    for (const item of mergedItems) {
      const prodRes = await client.query(
        'SELECT product_id, product_name, sku, import_price, stock_qty, is_active FROM products WHERE product_id = $1 FOR UPDATE',
        [item.product_id]
      );
      if (prodRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Sản phẩm ID ${item.product_id} không tồn tại.` });
      }
      const prod = prodRes.rows[0];
      if (!prod.is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Sản phẩm "${prod.product_name}" (${prod.sku}) hiện đã ngừng kinh doanh.`,
        });
      }
      if (req.session.user.role === 'BanHang' && item.unit_price < Number(prod.import_price)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Nhân viên bán hàng không được phép bán "${prod.product_name}" dưới giá vốn (vui lòng liên hệ Admin hoặc Kế toán duyệt).`,
        });
      }
      if (prod.stock_qty < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Không đủ tồn kho cho "${prod.product_name}" (${prod.sku}). Hiện còn: ${prod.stock_qty}, yêu cầu xuất: ${item.quantity}.`,
        });
      }
    }

    const subtotal = mergedItems.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
    const vatPct = Number(vat_rate ?? 10);
    if (isNaN(vatPct) || vatPct < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Thuế suất VAT không hợp lệ.' });
    }
    const vatAmount = Math.round(subtotal * (vatPct / 100));
    const totalAmount = subtotal + vatAmount;

    const paid = Math.max(0, Number(paid_amount ?? totalAmount));
    if (paid > totalAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Số tiền khách trả không được lớn hơn tổng thanh toán.' });
    }

    const debtAmount = totalAmount - paid;
    if (debtAmount > 0) {
      if (Number(customer_id) === 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Khách lẻ tại quầy (#1) không được phép ghi nợ. Vui lòng thu đủ 100% hoặc chọn khách hàng định danh.',
        });
      }
      const custRes = await client.query(
        'SELECT customer_name, debt_amount, credit_limit FROM customers WHERE customer_id = $1 FOR UPDATE',
        [Number(customer_id)]
      );
      if (custRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Khách hàng không tồn tại.' });
      }
      const cust = custRes.rows[0];
      const newTotalDebt = Number(cust.debt_amount) + debtAmount;
      const limit = Number(cust.credit_limit || 0);
      if (newTotalDebt > limit) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Vượt hạn mức công nợ của "${cust.customer_name}"! Hạn mức tối đa: ${limit.toLocaleString('vi-VN')} ₫, tổng nợ sau đơn này sẽ là: ${newTotalDebt.toLocaleString('vi-VN')} ₫.`,
        });
      }
    }

    let paymentStatus = 'DaThanhToan';
    if (paid === 0 && totalAmount > 0) paymentStatus = 'GhiNo';
    else if (debtAmount > 0) paymentStatus = 'ThanhToanMotPhan';

    const effectiveMethod = paid === 0 && totalAmount > 0 ? 'CongNo' : (payment_method || 'TienMat');

    const invoiceNo = genDocNo('HD');
    const invRes = await client.query(
      `INSERT INTO invoices (invoice_no, customer_id, user_id, subtotal, vat_amount, total_amount, paid_amount, debt_amount, payment_method, payment_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        invoiceNo,
        Number(customer_id),
        req.session.user.user_id,
        subtotal,
        vatAmount,
        totalAmount,
        paid,
        debtAmount,
        effectiveMethod,
        paymentStatus,
        (notes || '').trim(),
      ]
    );
    const invoice = invRes.rows[0];

    for (const item of mergedItems) {
      await client.query(
        `INSERT INTO invoice_details (invoice_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [invoice.invoice_id, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price]
      );

      // Trừ tồn kho
      await client.query(
        'UPDATE products SET stock_qty = stock_qty - $1 WHERE product_id = $2',
        [item.quantity, item.product_id]
      );

      // Ghi nhận Serial/IMEI xuất bán để phục vụ bảo hành
      if (item.serials.length > 0) {
        await assignSerialsToInvoiceLine(client, invoice.invoice_id, item.product_id, item.quantity, item.serials);
      }
    }

    // Cộng công nợ khách hàng nếu ghi nợ
    if (debtAmount > 0) {
      await client.query(
        'UPDATE customers SET debt_amount = debt_amount + $1 WHERE customer_id = $2',
        [debtAmount, Number(customer_id)]
      );
    }

    // Ghi nhận phiếu thu nếu có thanh toán
    if (paid > 0) {
      const payNo = genDocNo('PT');
      const receiptMethod = ['TienMat', 'ChuyenKhoan', 'QuetThe'].includes(payment_method) ? payment_method : 'TienMat';
      await client.query(
        `INSERT INTO payments (payment_no, payment_type, invoice_id, user_id, amount, payment_method, notes)
         VALUES ($1, 'Thu', $2, $3, $4, $5, $6)`,
        [payNo, invoice.invoice_id, req.session.user.user_id, paid, receiptMethod, `Thu tiền hóa đơn ${invoiceNo}`]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(invoice);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Sales error:', err);
    res.status(500).json({ error: 'Lỗi lập hóa đơn bán hàng: ' + err.message });
  } finally {
    client.release();
  }
});

// Hủy hóa đơn hoặc Gửi yêu cầu Đổi/trả hàng (ChoTraHang -> chờ Kho kiểm nhận)
router.put('/:id/status', requireRole('Admin', 'KeToan', 'BanHang'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, reason } = req.body;
    if (!['DaHuy', 'ChoTraHang'].includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ. Chỉ chấp nhận DaHuy hoặc ChoTraHang.' });
    }

    await client.query('BEGIN');
    const invRes = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [req.params.id]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy hóa đơn.' });
    }
    const inv = invRes.rows[0];
    if (['DaHuy', 'DaDoiTra', 'ChoTraHang'].includes(inv.payment_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Hóa đơn này đã hủy, đổi trả hoặc đang chờ kiểm nhận trả hàng.' });
    }

    if (status === 'ChoTraHang') {
      const noteAppend = `[Yêu cầu Đổi/Trả — Chờ Kho kiểm nhận${reason ? ': ' + reason.trim() : ''}]`;
      const newNotes = inv.notes ? `${inv.notes} | ${noteAppend}` : noteAppend;
      // Nếu đơn trước đó là ChoThanhToan (online chưa trả tiền) thì xóa debt_amount vì không phải nợ TK 131
      const nextDebt = inv.payment_status === 'ChoThanhToan' ? 0 : Number(inv.debt_amount);

      const updated = await client.query(
        `UPDATE invoices SET payment_status = 'ChoTraHang', debt_amount = $1, notes = $2 WHERE invoice_id = $3 RETURNING *`,
        [nextDebt, newNotes, inv.invoice_id]
      );
      await client.query('COMMIT');
      return res.json(updated.rows[0]);
    }

    // Không cho phép Hủy ngang nếu hóa đơn đã phát sinh thu tiền -> bắt buộc qua Đổi/Trả hàng
    if (Number(inv.paid_amount) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Hóa đơn đã phát sinh thu tiền không thể hủy ngang. Vui lòng chuyển sang "Yêu cầu Đổi/Trả hàng" để Thủ kho kiểm nhận hàng và Kế toán lập Phiếu chi hoàn tiền.',
      });
    }

    // Nếu là Hủy đơn (DaHuy) chưa thu tiền: hoàn tồn kho ngay và trừ công nợ TK 131 nếu có
    const details = await client.query('SELECT product_id, quantity FROM invoice_details WHERE invoice_id = $1', [inv.invoice_id]);
    for (const d of details.rows) {
      await client.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE product_id = $2', [d.quantity, d.product_id]);
    }
    await client.query(`UPDATE warranty_serials SET status = 'TrongKho', invoice_id = NULL WHERE invoice_id = $1`, [inv.invoice_id]);

    if (Number(inv.debt_amount) > 0 && inv.payment_status !== 'ChoThanhToan') {
      await client.query(
        'UPDATE customers SET debt_amount = GREATEST(0, debt_amount - $1) WHERE customer_id = $2',
        [Number(inv.debt_amount), inv.customer_id]
      );
    }

    const noteAppend = `[Đã hủy HĐ${reason ? ': ' + reason.trim() : ''}]`;
    const newNotes = inv.notes ? `${inv.notes} | ${noteAppend}` : noteAppend;
    const updated = await client.query(
      `UPDATE invoices SET payment_status = 'DaHuy', debt_amount = 0, notes = $1 WHERE invoice_id = $2 RETURNING *`,
      [newNotes, inv.invoice_id]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cancel/Return invoice error:', err);
    res.status(500).json({ error: 'Lỗi cập nhật trạng thái hóa đơn.' });
  } finally {
    client.release();
  }
});

// Bước 2: Thủ kho / Admin kiểm nhận hàng hoàn trả & xếp lại lên kệ (hoặc ghi nhận hàng lỗi)
router.post('/:id/confirm-return', requireRole('Admin', 'ThuKho'), async (req, res) => {
  const client = await pool.connect();
  try {
    const isDefective = Boolean(req.body?.is_defective);
    const notes = (req.body?.notes || '').trim();
    const shelfMap = new Map();
    if (Array.isArray(req.body?.shelf_assignments)) {
      for (const a of req.body.shelf_assignments) {
        if (a && a.product_id && a.shelf_location) {
          shelfMap.set(Number(a.product_id), String(a.shelf_location).trim());
        }
      }
    }

    await client.query('BEGIN');
    const invRes = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [req.params.id]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy hóa đơn.' });
    }
    const inv = invRes.rows[0];
    if (inv.payment_status !== 'ChoTraHang') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Hóa đơn này không ở trạng thái Chờ Kho kiểm nhận trả hàng.' });
    }

    if (!isDefective) {
      const details = await client.query('SELECT product_id, quantity FROM invoice_details WHERE invoice_id = $1', [inv.invoice_id]);
      for (const d of details.rows) {
        const assignedShelf = shelfMap.get(Number(d.product_id));
        if (assignedShelf) {
          await client.query('UPDATE products SET stock_qty = stock_qty + $1, shelf_location = $2 WHERE product_id = $3', [
            d.quantity,
            assignedShelf,
            d.product_id,
          ]);
        } else {
          await client.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE product_id = $2', [d.quantity, d.product_id]);
        }
      }
      await client.query(`UPDATE warranty_serials SET status = 'TrongKho', invoice_id = NULL WHERE invoice_id = $1`, [inv.invoice_id]);
    } else {
      await client.query(`UPDATE warranty_serials SET status = 'BaoHanh', invoice_id = NULL WHERE invoice_id = $1`, [inv.invoice_id]);
    }

    if (Number(inv.debt_amount) > 0) {
      await client.query(
        'UPDATE customers SET debt_amount = GREATEST(0, debt_amount - $1) WHERE customer_id = $2',
        [Number(inv.debt_amount), inv.customer_id]
      );
    }

    const whLabel = isDefective ? 'Kho xác nhận hàng LỖI (Chuyển Bảo hành)' : 'Kho đã kiểm nhận nguyên vẹn & Xếp lên kệ';
    const noteAppend = `[${whLabel}${notes ? ': ' + notes : ''}]`;
    const newNotes = inv.notes ? `${inv.notes} | ${noteAppend}` : noteAppend;

    const updated = await client.query(
      `UPDATE invoices SET payment_status = 'DaDoiTra', debt_amount = 0, notes = $1 WHERE invoice_id = $2 RETURNING *`,
      [newNotes, inv.invoice_id]
    );

    await client.query('COMMIT');
    res.json({ message: `${whLabel} cho hóa đơn ${inv.invoice_no}!`, invoice: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Confirm return error:', err);
    res.status(500).json({ error: 'Lỗi xác nhận kiểm nhận hàng trả.' });
  } finally {
    client.release();
  }
});

// Bước 3: Kế toán lập Phiếu chi hoàn tiền cho khách (chỉ sau khi Kho đã kiểm nhận DaDoiTra)
router.post('/:id/refund', requireRole('Admin', 'KeToan'), async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body?.amount || 0);
    const paymentMethod = req.body?.payment_method || 'ChuyenKhoan';
    const notes = (req.body?.notes || '').trim();

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Số tiền hoàn phải lớn hơn 0.' });
    }

    await client.query('BEGIN');
    const invRes = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [req.params.id]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy hóa đơn.' });
    }
    const inv = invRes.rows[0];
    if (inv.payment_status !== 'DaDoiTra') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Chỉ được chi tiền hoàn sau khi Kho đã kiểm nhận hàng trả (DaDoiTra).' });
    }
    if (amount > Number(inv.paid_amount)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Số tiền hoàn vượt quá số khách đã thanh toán (${Number(inv.paid_amount).toLocaleString('vi-VN')} ₫).` });
    }

    const dup = await client.query("SELECT 1 FROM payments WHERE invoice_id = $1 AND payment_type = 'Chi'", [inv.invoice_id]);
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Hóa đơn này đã được lập Phiếu chi hoàn tiền trước đó.' });
    }

    const payNo = genDocNo('PC');
    await client.query(
      `INSERT INTO payments (payment_no, payment_type, invoice_id, user_id, amount, payment_method, notes)
       VALUES ($1, 'Chi', $2, $3, $4, $5, $6)`,
      [payNo, inv.invoice_id, req.session.user.user_id, amount, paymentMethod, notes || `Hoàn tiền trả hàng hóa đơn ${inv.invoice_no}`]
    );

    await client.query('COMMIT');
    res.json({ message: `Đã lập Phiếu chi hoàn tiền ${payNo} thành công!`, payment_no: payNo });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Refund invoice error:', err);
    res.status(500).json({ error: 'Lỗi lập phiếu chi hoàn tiền.' });
  } finally {
    client.release();
  }
});

// Gán bổ sung Serial cho hóa đơn (ví dụ đơn đặt Online khi đóng gói xuất kho)
router.put('/:id/serials', requireRole('Admin', 'BanHang', 'KeToan', 'ThuKho'), async (req, res) => {
  const client = await pool.connect();
  try {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Vui lòng cung cấp danh sách sản phẩm và Serial.' });
    }

    await client.query('BEGIN');
    const invRes = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [req.params.id]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy hóa đơn.' });
    }
    const inv = invRes.rows[0];
    if (['DaHuy', 'DaDoiTra', 'ChoTraHang'].includes(inv.payment_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Không thể gán Serial cho hóa đơn đã hủy hoặc đang đổi trả.' });
    }

    const detailsRes = await client.query('SELECT product_id, quantity FROM invoice_details WHERE invoice_id = $1', [inv.invoice_id]);
    const qtyByProd = new Map();
    for (const d of detailsRes.rows) {
      qtyByProd.set(Number(d.product_id), (qtyByProd.get(Number(d.product_id)) || 0) + Number(d.quantity));
    }

    for (const it of items) {
      const pid = Number(it.product_id);
      const maxQty = qtyByProd.get(pid);
      if (!maxQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Sản phẩm ID ${pid} không có trong hóa đơn này.` });
      }
      if (Array.isArray(it.serials) && it.serials.length > 0) {
        await assignSerialsToInvoiceLine(client, inv.invoice_id, pid, maxQty, it.serials);
      }
    }

    await client.query('COMMIT');
    res.json({ message: `Đã cập nhật Serial bảo hành cho hóa đơn ${inv.invoice_no}.` });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Assign serials error:', err);
    res.status(500).json({ error: 'Lỗi gán Serial cho hóa đơn.' });
  } finally {
    client.release();
  }
});

// Xác nhận thu tiền / gạch nợ trực tiếp trên 1 hóa đơn (đơn online COD / CK hoặc hóa đơn ghi nợ)
router.post('/:id/collect', requireRole('Admin', 'BanHang', 'KeToan'), async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount || 0);
    const paymentMethod = req.body.payment_method;
    const notes = (req.body.notes || '').trim();
    const serialItems = Array.isArray(req.body.serials) ? req.body.serials : [];

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Số tiền thu phải lớn hơn 0.' });
    }

    await client.query('BEGIN');

    const invRes = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [req.params.id]);
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy hóa đơn.' });
    }
    const inv = invRes.rows[0];
    if (['DaHuy', 'DaDoiTra', 'ChoTraHang'].includes(inv.payment_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Không thể thu tiền cho hóa đơn đã hủy hoặc đang đổi trả.' });
    }

    const currentDebt = Number(inv.debt_amount);
    if (currentDebt <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Hóa đơn này đã thanh toán đủ.' });
    }
    if (amount > currentDebt) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Số tiền thu (${amount.toLocaleString('vi-VN')} ₫) vượt quá số còn nợ (${currentDebt.toLocaleString('vi-VN')} ₫).`,
      });
    }

    const rawMethod = paymentMethod || inv.payment_method;
    const finalMethod = ['TienMat', 'ChuyenKhoan', 'QuetThe'].includes(rawMethod) ? rawMethod : 'ChuyenKhoan';
    const newDebt = currentDebt - amount;
    const newStatus = newDebt === 0 ? 'DaThanhToan' : 'ThanhToanMotPhan';

    // Nếu trước đó là đơn Online (ChoThanhToan, chưa hạch toán nợ vào TK 131):
    // - Thu đủ (newDebt === 0) -> không đổi customers.debt_amount
    // - Thu một phần (newDebt > 0) -> kiểm tra hạn mức & cộng phần còn nợ newDebt vào TK 131
    if (inv.payment_status === 'ChoThanhToan') {
      if (newDebt > 0) {
        if (inv.customer_id === 1) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Khách lẻ tại quầy (#1) không được phép ghi nợ phần còn lại.' });
        }
        const custRes = await client.query(
          'SELECT customer_name, debt_amount, credit_limit FROM customers WHERE customer_id = $1 FOR UPDATE',
          [inv.customer_id]
        );
        const cust = custRes.rows[0];
        const nextCustDebt = Number(cust.debt_amount) + newDebt;
        const limit = Number(cust.credit_limit || 0);
        if (nextCustDebt > limit) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Vượt hạn mức công nợ của "${cust.customer_name}"! Phần còn lại (${newDebt.toLocaleString('vi-VN')} ₫) khiến tổng nợ vượt hạn mức ${limit.toLocaleString('vi-VN')} ₫.`,
          });
        }
        await client.query('UPDATE customers SET debt_amount = debt_amount + $1 WHERE customer_id = $2', [
          newDebt,
          inv.customer_id,
        ]);
      }
    } else {
      await client.query(
        'UPDATE customers SET debt_amount = GREATEST(0, debt_amount - $1) WHERE customer_id = $2',
        [amount, inv.customer_id]
      );
    }

    const updated = await client.query(
      `UPDATE invoices
       SET paid_amount = paid_amount + $1, debt_amount = $2, payment_status = $3, payment_method = $4
       WHERE invoice_id = $5 RETURNING *`,
      [amount, newDebt, newStatus, finalMethod, inv.invoice_id]
    );

    if (serialItems.length > 0) {
      const detailsRes = await client.query('SELECT product_id, quantity FROM invoice_details WHERE invoice_id = $1', [inv.invoice_id]);
      const qtyByProd = new Map();
      for (const d of detailsRes.rows) {
        qtyByProd.set(Number(d.product_id), (qtyByProd.get(Number(d.product_id)) || 0) + Number(d.quantity));
      }
      for (const it of serialItems) {
        const pid = Number(it.product_id);
        const maxQty = qtyByProd.get(pid);
        if (maxQty && Array.isArray(it.serials) && it.serials.length > 0) {
          await assignSerialsToInvoiceLine(client, inv.invoice_id, pid, maxQty, it.serials);
        }
      }
    }

    const payNo = genDocNo('PT');
    await client.query(
      `INSERT INTO payments (payment_no, payment_type, invoice_id, user_id, amount, payment_method, notes)
       VALUES ($1, 'Thu', $2, $3, $4, $5, $6)`,
      [
        payNo,
        inv.invoice_id,
        req.session.user.user_id,
        amount,
        finalMethod,
        notes || `Xác nhận thu tiền hóa đơn ${inv.invoice_no}`,
      ]
    );

    await client.query('COMMIT');
    res.json({ message: 'Đã xác nhận thu tiền và lập Phiếu thu thành công!', invoice: updated.rows[0], payment_no: payNo });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Collect invoice error:', err);
    res.status(500).json({ error: 'Lỗi xác nhận thu tiền: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

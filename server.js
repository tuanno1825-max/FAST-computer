require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const pool = require('./db');
const crudRoutes = require('./routes/crud');
const purchaseRoutes = require('./routes/purchase');
const salesRoutes = require('./routes/sales');
const inventoryRoutes = require('./routes/inventory');
const extraRoutes = require('./routes/extra');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fast_computer_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 giờ
      httpOnly: true,
    },
  })
);

// Middleware đồng bộ trạng thái hoạt động (is_active) & quyền từ DB cho mọi phiên đăng nhập
async function syncSessionUser(req, res, next) {
  if (!req.session || !req.session.user) return next();
  if (req.path === '/auth/logout') return next();
  try {
    const r = await pool.query(
      'SELECT user_id, username, full_name, role, is_active FROM users WHERE user_id = $1',
      [req.session.user.user_id]
    );
    if (r.rows.length === 0 || !r.rows[0].is_active) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: 'Tài khoản của bạn đã bị khóa hoặc không còn tồn tại.' });
    }
    req.session.user = {
      user_id: r.rows[0].user_id,
      username: r.rows[0].username,
      full_name: r.rows[0].full_name,
      role: r.rows[0].role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// Middleware kiểm tra đăng nhập
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên làm việc đã hết hạn.' });
  }
  next();
}

// Middleware phân quyền đơn giản
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Chưa đăng nhập.' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

// Phục vụ file tĩnh (Frontend) - tắt tự động trỏ index.html ở "/" để "/" phục vụ shop.html
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Kiểm tra trạng thái khóa tài khoản theo thời gian thực trên toàn bộ /api
app.use('/api', syncSessionUser);

// Gắn các router nghiệp vụ & CRUD
app.use('/api', crudRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/invoices', salesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api', extraRoutes);

// ============================================================================
// API ĐĂNG NHẬP & PHÂN QUYỀN
// ============================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' });
    }

    const result = await pool.query(
      'SELECT user_id, username, password_hash, full_name, role, is_active FROM users WHERE username = $1',
      [username.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Tài khoản này đã bị khóa.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }

    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1', [user.user_id]);

    req.session.user = {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
    };

    res.json({ message: 'Đăng nhập thành công!', user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Lỗi kết nối cơ sở dữ liệu.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Đã đăng xuất.' });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  res.json({ user: req.session.user });
});

// ============================================================================
// API DASHBOARD (TRANG CHỦ TỔNG QUAN)
// ============================================================================
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const period = (req.query.period || 'all').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();

    let invDateCond = '';
    let recDateCond = '';
    const invParams = [];
    const recParams = [];

    if (from || to) {
      const invConds = [];
      const recConds = [];
      if (from) {
        invParams.push(from);
        invConds.push(`DATE(invoice_date) >= $${invParams.length}`);
        recParams.push(from);
        recConds.push(`DATE(receipt_date) >= $${recParams.length}`);
      }
      if (to) {
        invParams.push(to);
        invConds.push(`DATE(invoice_date) <= $${invParams.length}`);
        recParams.push(to);
        recConds.push(`DATE(receipt_date) <= $${recParams.length}`);
      }
      invDateCond = ' AND ' + invConds.join(' AND ');
      recDateCond = ' WHERE ' + recConds.join(' AND ');
    } else if (period === 'today') {
      invDateCond = ' AND DATE(invoice_date) = CURRENT_DATE';
      recDateCond = ' WHERE DATE(receipt_date) = CURRENT_DATE';
    } else if (period === '7d') {
      invDateCond = " AND invoice_date >= CURRENT_DATE - INTERVAL '6 days'";
      recDateCond = " WHERE receipt_date >= CURRENT_DATE - INTERVAL '6 days'";
    } else if (period === 'month') {
      invDateCond = " AND DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)";
      recDateCond = " WHERE DATE_TRUNC('month', receipt_date) = DATE_TRUNC('month', CURRENT_DATE)";
    }

    const isBanHang = req.session.user.role === 'BanHang';

    const [revRes, balRes, lowStockRes, recentInvoicesRes, recentReceiptsRes, categoryStockRes] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(total_amount), 0) AS total_revenue,
           COUNT(*) AS total_invoices
         FROM invoices
         WHERE payment_status NOT IN ('DaHuy', 'DaDoiTra', 'ChoTraHang')${invDateCond}`,
        invParams
      ),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM products) AS total_products,
          (SELECT COALESCE(SUM(stock_qty), 0) FROM products) AS total_stock,
          (SELECT COUNT(*) FROM products WHERE stock_qty <= min_stock) AS low_stock_count,
          (SELECT COALESCE(SUM(debt_amount), 0) FROM customers) AS total_customer_debt,
          (SELECT COALESCE(SUM(payable_balance), 0) FROM suppliers) AS total_supplier_payable
      `),
      pool.query(`
        SELECT p.product_id, p.sku, p.product_name, p.stock_qty, p.min_stock, p.shelf_location, c.category_name
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        WHERE p.stock_qty <= p.min_stock
        ORDER BY p.stock_qty ASC
        LIMIT 8
      `),
      pool.query(
        `SELECT i.invoice_id, i.invoice_no, i.invoice_date, i.total_amount, i.paid_amount, i.debt_amount, i.payment_status,
                c.customer_name, u.full_name AS staff_name
         FROM invoices i
         JOIN customers c ON i.customer_id = c.customer_id
         JOIN users u ON i.user_id = u.user_id
         WHERE 1=1${invDateCond}
         ORDER BY i.invoice_date DESC
         LIMIT 5`,
        invParams
      ),
      isBanHang
        ? Promise.resolve({ rows: [] })
        : pool.query(
            `SELECT pr.receipt_id, pr.receipt_no, pr.receipt_date, pr.total_amount, pr.paid_amount,
                    s.supplier_name, u.full_name AS staff_name
             FROM purchase_receipts pr
             JOIN suppliers s ON pr.supplier_id = s.supplier_id
             JOIN users u ON pr.user_id = u.user_id
             ${recDateCond}
             ORDER BY pr.receipt_date DESC
             LIMIT 5`,
            recParams
          ),
      pool.query(`
        SELECT c.category_name, COALESCE(SUM(p.stock_qty), 0)::INT AS qty,
               COALESCE(SUM(p.stock_qty * p.import_price), 0)::NUMERIC AS inventory_value
        FROM categories c
        LEFT JOIN products p ON c.category_id = p.category_id
        GROUP BY c.category_id, c.category_name
        ORDER BY qty DESC
      `),
    ]);

    const kpi = { ...revRes.rows[0], ...balRes.rows[0] };
    let categoryStock = categoryStockRes.rows;
    if (isBanHang) {
      kpi.total_supplier_payable = null;
      categoryStock = categoryStock.map((c) => ({ ...c, inventory_value: null }));
    }

    res.json({
      kpi,
      lowStock: lowStockRes.rows,
      recentInvoices: recentInvoicesRes.rows,
      recentReceipts: recentReceiptsRes.rows,
      categoryStock,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Không thể tải dữ liệu Dashboard.' });
  }
});

// ============================================================================
// API PUBLIC CHO TRANG BÁN HÀNG (STOREFRONT)
// ============================================================================
app.get('/api/shop/categories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.category_id, c.category_name, COUNT(p.product_id)::INT AS product_count
      FROM categories c
      LEFT JOIN products p ON c.category_id = p.category_id AND p.is_active = TRUE
      GROUP BY c.category_id, c.category_name
      ORDER BY c.category_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh mục sản phẩm.' });
  }
});

app.get('/api/shop/brands', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT brand, COUNT(*)::INT AS product_count
      FROM products
      WHERE is_active = TRUE AND COALESCE(brand, '') <> ''
      GROUP BY brand
      ORDER BY product_count DESC, brand ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách hãng.' });
  }
});

app.get('/api/shop/products', async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const categoryId = req.query.category_id;
    const brand = (req.query.brand || '').trim();
    const onlyInStock = req.query.in_stock === 'true';
    const sort = req.query.sort || 'newest';

    let sql = `
      SELECT p.product_id, p.sku, p.product_name, p.brand, p.unit, p.sale_price, p.stock_qty,
             p.warranty_months, p.shelf_location, p.image_url, p.specs, c.category_id, c.category_name
      FROM products p
      JOIN categories c ON p.category_id = c.category_id
      WHERE p.is_active = TRUE
        AND (p.product_name ILIKE $1 OR p.sku ILIKE $1 OR c.category_name ILIKE $1 OR COALESCE(p.brand, '') ILIKE $1)
    `;
    const params = [q];
    if (categoryId) {
      params.push(Number(categoryId));
      sql += ` AND p.category_id = $${params.length}`;
    }
    if (brand) {
      params.push(brand);
      sql += ` AND p.brand = $${params.length}`;
    }
    if (onlyInStock) {
      sql += ' AND p.stock_qty > 0';
    }

    if (sort === 'price_asc') sql += ' ORDER BY p.sale_price ASC';
    else if (sort === 'price_desc') sql += ' ORDER BY p.sale_price DESC';
    else sql += ' ORDER BY p.product_id DESC';

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách linh kiện.' });
  }
});

app.post('/api/shop/checkout', async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer_name, phone, address, payment_method, notes, items } = req.body;
    const cleanPhone = (phone || '').trim();
    if (!customer_name || !customer_name.trim() || !cleanPhone || !/^0\d{8,10}$/.test(cleanPhone) || cleanPhone === '0000000000') {
      return res.status(400).json({ error: 'Vui lòng nhập Họ tên và Số điện thoại hợp lệ (bắt đầu bằng 0, 9-11 số).' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Giỏ hàng đang trống.' });
    }

    // Gộp các dòng trùng product_id trong giỏ hàng để kiểm tra tồn chính xác
    const qtyByProduct = new Map();
    for (const item of items) {
      const qty = Number(item.quantity);
      const pid = Number(item.product_id);
      if (!pid || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Số lượng đặt mua không hợp lệ.' });
      }
      qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + qty);
    }

    await client.query('BEGIN');

    // Tìm hoặc tạo mới khách hàng theo SĐT (không ghi đè tên pháp nhân khách cũ trong sổ kế toán)
    let customerId;
    const custRes = await client.query(
      'SELECT customer_id, customer_name, address FROM customers WHERE phone = $1 FOR UPDATE',
      [cleanPhone]
    );
    if (custRes.rows.length > 0) {
      const existingCust = custRes.rows[0];
      customerId = existingCust.customer_id;
      if (!existingCust.address && address && address.trim()) {
        await client.query('UPDATE customers SET address = $1 WHERE customer_id = $2', [
          address.trim(),
          customerId,
        ]);
      }
    } else {
      const newCust = await client.query(
        'INSERT INTO customers (customer_name, phone, address) VALUES ($1, $2, $3) RETURNING customer_id',
        [customer_name.trim(), cleanPhone, (address || '').trim()]
      );
      customerId = newCust.rows[0].customer_id;
    }

    // Kiểm tra tồn kho & trạng thái đang kinh doanh từng sản phẩm
    let subtotal = 0;
    const resolvedItems = [];
    for (const [pid, qty] of qtyByProduct.entries()) {
      const prodRes = await client.query(
        'SELECT product_id, product_name, sku, sale_price, stock_qty, is_active FROM products WHERE product_id = $1 FOR UPDATE',
        [pid]
      );
      if (prodRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Sản phẩm không tồn tại.' });
      }
      const prod = prodRes.rows[0];
      if (!prod.is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Sản phẩm "${prod.product_name}" hiện đã ngừng kinh doanh.` });
      }
      if (prod.stock_qty < qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Sản phẩm "${prod.product_name}" chỉ còn ${prod.stock_qty} chiếc trong kho.`,
        });
      }
      const price = Number(prod.sale_price);
      subtotal += price * qty;
      resolvedItems.push({ product_id: prod.product_id, quantity: qty, unit_price: price });
    }

    const vatAmount = Math.round(subtotal * 0.1);
    const totalAmount = subtotal + vatAmount;
    const invoiceNo = 'HD-' + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
    const payMethod = ['TienMat', 'ChuyenKhoan'].includes(payment_method) ? payment_method : 'ChuyenKhoan';
    const orderTag = payMethod === 'TienMat' ? '[Đặt Online - COD]' : '[Đặt Online - CK]';
    const receiverInfo = `Người nhận: ${customer_name.trim()}${address && address.trim() ? ' - ĐC: ' + address.trim() : ''}`;
    const fullNotes = `${orderTag} ${receiverInfo}${notes && notes.trim() ? ' | ' + notes.trim() : ''}`;

    // Ưu tiên gán cho nhân viên Bán hàng đang hoạt động
    const staffRes = await client.query(
      "SELECT user_id FROM users WHERE is_active = TRUE ORDER BY CASE WHEN role = 'BanHang' THEN 0 WHEN role = 'Admin' THEN 1 ELSE 2 END, user_id ASC LIMIT 1"
    );
    const staffId = staffRes.rows[0].user_id;

    // Ghi nhận hóa đơn online ở trạng thái Chờ thanh toán (không cộng vào công nợ mua chịu TK 131)
    const invRes = await client.query(
      `INSERT INTO invoices (invoice_no, customer_id, user_id, subtotal, vat_amount, total_amount, paid_amount, debt_amount, payment_status, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $6, 'ChoThanhToan', $7, $8) RETURNING *`,
      [invoiceNo, customerId, staffId, subtotal, vatAmount, totalAmount, payMethod, fullNotes]
    );
    const invoice = invRes.rows[0];

    for (const it of resolvedItems) {
      await client.query(
        `INSERT INTO invoice_details (invoice_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [invoice.invoice_id, it.product_id, it.quantity, it.unit_price, it.quantity * it.unit_price]
      );
      await client.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE product_id = $2', [
        it.quantity,
        it.product_id,
      ]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Đặt hàng thành công!',
      invoice_id: invoice.invoice_id,
      invoice_no: invoiceNo,
      total_amount: totalAmount,
      payment_method: payMethod,
      payment_status: 'ChoThanhToan',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Lỗi xử lý đặt hàng: ' + err.message });
  } finally {
    client.release();
  }
});

// Trang chủ mặc định trỏ tới Trang bán hàng cho khách (shop.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shop.html'));
});

// Trang Quản trị & Kế toán nội bộ
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 FAST Computer Server đang chạy tại http://localhost:${PORT}`);
});

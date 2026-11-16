let currentUser = null;
let cachedCategories = [];
let cachedProducts = [];
let cachedCustomers = [];
let cachedSuppliers = [];

const ROLE_LABELS = {
  Admin: 'Quản lý (Admin)',
  KeToan: 'Kế toán viên',
  BanHang: 'Nhân viên Bán hàng',
  ThuKho: 'Thủ kho & Kỹ thuật',
};

const STATUS_BADGES = {
  DaThanhToan: '<span class="badge badge-success">Đã thanh toán</span>',
  ThanhToanMotPhan: '<span class="badge badge-warning">Thanh toán 1 phần</span>',
  ChoThanhToan: '<span class="badge badge-warning" style="background:#dbeafe;color:#1d4ed8;">⏳ Chờ thanh toán</span>',
  ChoTraHang: '<span class="badge badge-warning" style="background:#ffedd5;color:#c2410c;">⏳ Chờ Kho nhận trả</span>',
  GhiNo: '<span class="badge badge-danger">Ghi nợ</span>',
  DaHuy: '<span class="badge badge-secondary" style="background:#e2e8f0;color:#475569;">Đã hủy</span>',
  DaDoiTra: '<span class="badge badge-warning" style="background:#fef3c7;color:#b45309;">Đã đổi/trả (RMA)</span>',
};

const PAYMENT_METHOD_LABELS = {
  TienMat: '💵 Tiền mặt',
  ChuyenKhoan: '🏦 Chuyển khoản',
  QuetThe: '💳 Quẹt thẻ',
  CongNo: '📝 Công nợ',
};

function formatVND(value) {
  return Number(value || 0).toLocaleString('vi-VN') + ' ₫';
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => {
    t.className = 'toast';
  }, 3500);
}

function openModal(title, html, large = false) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBox').className = large ? 'modal-box modal-lg' : 'modal-box';
  document.getElementById('appModal').classList.add('open');
}

function closeModal() {
  document.getElementById('appModal').classList.remove('open');
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Thao tác thất bại.');
  }
  return data;
}

// ============================================================================
// KHỞI TẠO & ĐIỀU HƯỚNG
// ============================================================================
async function initApp() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return;
    }
    const { user } = await res.json();
    currentUser = user;
    document.getElementById('userName').textContent = user.full_name;
    document.getElementById('userRole').textContent = ROLE_LABELS[user.role] || user.role;

    applyRolePermissions(user.role);
    setupNavigation();
    await loadDashboard();
  } catch (err) {
    console.error('Lỗi khởi tạo:', err);
  }
}

function applyRolePermissions(role) {
  document.querySelectorAll('.nav-item[data-roles]').forEach((item) => {
    const allowed = item.getAttribute('data-roles').split(',');
    if (!allowed.includes(role)) {
      item.classList.add('hidden');
    }
  });
}

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const dashboardTab = document.getElementById('tab-dashboard');
  const dynamicTab = document.getElementById('tab-dynamic');
  const pageTitle = document.getElementById('pageTitle');

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');

      const tab = item.getAttribute('data-tab');
      pageTitle.textContent = item.textContent.trim();

      if (tab === 'dashboard') {
        dashboardTab.style.display = 'block';
        dynamicTab.style.display = 'none';
        loadDashboard();
      } else {
        dashboardTab.style.display = 'none';
        dynamicTab.style.display = 'block';
        renderTab(tab);
      }
    });
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

function renderTab(tab) {
  if (tab === 'products') return renderProductsTab();
  if (tab === 'categories') return renderCategoriesTab();
  if (tab === 'customers') return renderCustomersTab();
  if (tab === 'suppliers') return renderSuppliersTab();
  if (tab === 'users') return renderUsersTab();
  if (tab === 'purchase') return renderPurchaseTab();
  if (tab === 'sales') return renderSalesTab();
  if (tab === 'inventory') return renderInventoryTab();
  if (tab === 'stocktake') return renderStocktakeTab();
  if (tab === 'finance') return renderFinanceTab();
  if (tab === 'warranty') return renderWarrantyTab();
  if (tab === 'reports') return renderReportsTab();
}

// ============================================================================
// 0. DASHBOARD
// ============================================================================
let currentDashPeriod = 'all';

function setDashboardPeriod(period, btn) {
  currentDashPeriod = period;
  document.getElementById('dashFrom').value = '';
  document.getElementById('dashTo').value = '';
  document.querySelectorAll('.dash-period-btn').forEach((b) => {
    b.className = b === btn ? 'btn btn-primary btn-sm dash-period-btn' : 'btn btn-outline btn-sm dash-period-btn';
  });
  loadDashboard(period);
}

function applyDashboardDateRange() {
  const from = document.getElementById('dashFrom').value;
  const to = document.getElementById('dashTo').value;
  document.querySelectorAll('.dash-period-btn').forEach((b) => {
    b.className = 'btn btn-outline btn-sm dash-period-btn';
  });
  loadDashboard('custom', from, to);
}

async function loadDashboard(period = currentDashPeriod, from = '', to = '') {
  try {
    const params = new URLSearchParams();
    if (period) params.set('period', period);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const data = await apiFetch(`/api/dashboard?${params.toString()}`);
    const kpi = data.kpi;
    document.getElementById('kpiTotalRevenue').textContent = formatVND(kpi.total_revenue);
    document.getElementById('kpiTotalInvoices').textContent = `${kpi.total_invoices} hóa đơn đã lập`;
    document.getElementById('kpiTotalStock').textContent = Number(kpi.total_stock).toLocaleString('vi-VN');
    document.getElementById('kpiTotalProducts').textContent = `${kpi.total_products} mã linh kiện`;
    document.getElementById('kpiLowStock').textContent = kpi.low_stock_count;
    document.getElementById('kpiCustomerDebt').textContent = formatVND(kpi.total_customer_debt);
    document.getElementById('kpiSupplierPayable').textContent =
      kpi.total_supplier_payable === null
        ? 'Phải trả NCC (TK 331): *** (Bảo mật)'
        : `Phải trả NCC (TK 331): ${formatVND(kpi.total_supplier_payable)}`;

    document.getElementById('recentInvoicesBody').innerHTML = data.recentInvoices.length
      ? data.recentInvoices
          .map(
            (r) => `
          <tr>
            <td><strong>${r.invoice_no}</strong></td>
            <td>${r.customer_name}</td>
            <td class="text-right">${formatVND(r.total_amount)}</td>
            <td class="text-right">${formatVND(r.debt_amount)}</td>
            <td>${STATUS_BADGES[r.payment_status] || r.payment_status}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5">Chưa có hóa đơn nào.</td></tr>';

    document.getElementById('lowStockBody').innerHTML = data.lowStock.length
      ? data.lowStock
          .map(
            (p) => `
          <tr>
            <td><code>${p.sku}</code></td>
            <td>${p.product_name}</td>
            <td class="text-right"><strong style="color:#dc2626">${p.stock_qty}</strong></td>
            <td class="text-right">${p.min_stock}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="4">Tồn kho đều an toàn.</td></tr>';

    document.getElementById('recentReceiptsBody').innerHTML = data.recentReceipts.length
      ? data.recentReceipts
          .map(
            (r) => `
          <tr>
            <td><strong>${r.receipt_no}</strong></td>
            <td>${r.supplier_name}</td>
            <td>${r.staff_name}</td>
            <td class="text-right">${formatVND(r.total_amount)}</td>
          </tr>`
          )
          .join('')
      : currentUser.role === 'BanHang'
        ? '<tr><td colspan="4" style="color:#94a3b8;">Dữ liệu nhập kho được bảo mật theo phân quyền.</td></tr>'
        : '<tr><td colspan="4">Chưa có phiếu nhập nào.</td></tr>';

    document.getElementById('categoryStockBody').innerHTML = data.categoryStock.length
      ? data.categoryStock
          .map(
            (c) => `
          <tr>
            <td>${c.category_name}</td>
            <td class="text-right"><strong>${c.qty}</strong></td>
            <td class="text-right">${c.inventory_value === null ? '***' : formatVND(c.inventory_value)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="3">Chưa có dữ liệu.</td></tr>';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 1. QUẢN LÝ LOẠI HÀNG (CATEGORIES)
// ============================================================================
async function renderCategoriesTab(q = '') {
  const canEdit = ['Admin', 'KeToan', 'ThuKho'].includes(currentUser.role);
  const canDelete = ['Admin', 'KeToan'].includes(currentUser.role);

  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="search-box">
          <input type="text" id="catSearch" class="form-control" placeholder="Tìm theo tên hoặc mô tả loại hàng..." value="${q}" onkeydown="if(event.key==='Enter') renderCategoriesTab(this.value)" />
          <button class="btn btn-outline" onclick="renderCategoriesTab(document.getElementById('catSearch').value)">Tìm</button>
        </div>
        ${canEdit ? `<button class="btn btn-primary" onclick="openCategoryModal()">+ Thêm loại hàng</button>` : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Tên loại hàng</th>
              <th>Mô tả</th>
              <th class="text-right">Số sản phẩm</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="catBody"><tr><td colspan="5">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const rows = await apiFetch(`/api/categories?q=${encodeURIComponent(q)}`);
  cachedCategories = rows;
  document.getElementById('catBody').innerHTML = rows.length
    ? rows
        .map(
          (c) => `
      <tr>
        <td>#${c.category_id}</td>
        <td><strong>${c.category_name}</strong></td>
        <td>${c.description || '-'}</td>
        <td class="text-right">
          <button class="btn btn-outline btn-sm" style="color:#2563eb; border-color:#bfdbfe; background:#eff6ff;" onclick="jumpToCategoryProducts(${c.category_id})">
            ${c.product_count} sản phẩm →
          </button>
        </td>
        <td class="text-right">
          <div class="action-btns">
            ${canEdit ? `<button class="btn btn-outline btn-sm" onclick='openCategoryModal(${JSON.stringify(c)})'>Sửa</button>` : ''}
            ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteCategory(${c.category_id})">Xóa</button>` : ''}
          </div>
        </td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="5">Không tìm thấy loại hàng nào.</td></tr>';
}

function openCategoryModal(cat = null) {
  openModal(
    cat ? 'Cập nhật Loại hàng' : 'Thêm Loại hàng mới',
    `
    <form onsubmit="saveCategory(event, ${cat ? cat.category_id : 'null'})">
      <div class="form-group">
        <label>Tên loại hàng *</label>
        <input type="text" id="fCatName" class="form-control" value="${cat ? cat.category_name : ''}" required />
      </div>
      <div class="form-group">
        <label>Mô tả</label>
        <textarea id="fCatDesc" class="form-control" rows="3">${cat ? cat.description || '' : ''}</textarea>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">${cat ? 'Lưu thay đổi' : 'Thêm mới'}</button>
      </div>
    </form>`
  );
}

async function saveCategory(e, id) {
  e.preventDefault();
  try {
    const body = {
      category_name: document.getElementById('fCatName').value,
      description: document.getElementById('fCatDesc').value,
    };
    if (id) await apiFetch(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    showToast(id ? 'Đã cập nhật loại hàng.' : 'Đã thêm loại hàng mới.');
    renderCategoriesTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteCategory(id) {
  if (!confirm('Bạn có chắc muốn xóa loại hàng này?')) return;
  try {
    await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
    showToast('Đã xóa loại hàng.');
    renderCategoriesTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function jumpToCategoryProducts(catId) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  const prodNav = document.querySelector('.nav-item[data-tab="products"]');
  if (prodNav) {
    prodNav.classList.add('active');
    document.getElementById('pageTitle').textContent = prodNav.textContent.trim();
  }
  renderProductsTab('', catId);
}

// ============================================================================
// 2. QUẢN LÝ SẢN PHẨM / LINH KIỆN (PRODUCTS)
// ============================================================================
async function renderProductsTab(q = '', catId = '', stockStatus = 'all', sort = 'newest') {
  const canEdit = ['Admin', 'KeToan', 'ThuKho'].includes(currentUser.role);
  const canDelete = ['Admin', 'KeToan'].includes(currentUser.role);
  const hideCost = currentUser.role === 'BanHang';

  if (cachedCategories.length === 0) {
    cachedCategories = await apiFetch('/api/categories');
  }

  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar" style="gap:8px;">
        <div class="search-box" style="max-width:none; flex-wrap:wrap;">
          <input type="text" id="prodSearch" class="form-control" style="min-width:200px; flex:1;" placeholder="Tìm SKU, tên linh kiện, hãng..." value="${q}" onkeydown="if(event.key==='Enter') applyProductFilters()" />
          <select id="prodCatFilter" class="form-control" style="max-width:170px;" onchange="applyProductFilters()">
            <option value="">Tất cả loại hàng</option>
            ${cachedCategories.map((c) => `<option value="${c.category_id}" ${String(catId) === String(c.category_id) ? 'selected' : ''}>${c.category_name}</option>`).join('')}
          </select>
          <select id="prodStockFilter" class="form-control" style="max-width:145px;" onchange="applyProductFilters()">
            <option value="all" ${stockStatus === 'all' ? 'selected' : ''}>Tất cả tồn</option>
            <option value="low" ${stockStatus === 'low' ? 'selected' : ''}>Sắp hết hàng</option>
            <option value="out" ${stockStatus === 'out' ? 'selected' : ''}>Hết hàng (0)</option>
          </select>
          <select id="prodSort" class="form-control" style="max-width:150px;" onchange="applyProductFilters()">
            <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Mới nhất</option>
            <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>Giá tăng dần</option>
            <option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>Giá giảm dần</option>
            <option value="stock_asc" ${sort === 'stock_asc' ? 'selected' : ''}>Tồn ít nhất</option>
            <option value="stock_desc" ${sort === 'stock_desc' ? 'selected' : ''}>Tồn nhiều nhất</option>
          </select>
          <button class="btn btn-outline" onclick="applyProductFilters()">Tìm</button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline" onclick="exportProductsCSV()">📥 Xuất Excel</button>
          ${canEdit ? `<button class="btn btn-primary" onclick="openProductModal()">+ Thêm sản phẩm</button>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ảnh</th>
              <th>SKU</th>
              <th>Tên linh kiện</th>
              <th>Hãng / Loại</th>
              ${hideCost ? '' : '<th class="text-right">Giá nhập</th>'}
              <th class="text-right">Giá bán</th>
              <th class="text-right">Tồn kho</th>
              <th>Bảo hành</th>
              <th>Trạng thái</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="prodBody"><tr><td colspan="10">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams({ q, stock_status: stockStatus, sort });
  if (catId) params.set('category_id', catId);

  const [rows, cats] = await Promise.all([
    apiFetch(`/api/products?${params.toString()}`),
    apiFetch('/api/categories'),
  ]);
  cachedProducts = rows;
  cachedCategories = cats;

  document.getElementById('prodBody').innerHTML = rows.length
    ? rows
        .map(
          (p) => `
      <tr>
        <td>
          ${
            p.image_url
              ? `<img src="${p.image_url}" alt="${p.sku}" style="width:40px; height:40px; object-fit:cover; border-radius:6px; border:1px solid #e2e8f0;" />`
              : `<div style="width:40px; height:40px; background:#f1f5f9; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:18px;">🖥️</div>`
          }
        </td>
        <td><code>${p.sku}</code></td>
        <td><strong>${p.product_name}</strong></td>
        <td>${p.brand ? `<strong>${p.brand}</strong> · ` : ''}<span style="color:#64748b;">${p.category_name}</span></td>
        ${hideCost ? '' : `<td class="text-right" style="white-space:nowrap;">${formatVND(p.import_price)}</td>`}
        <td class="text-right" style="white-space:nowrap;"><strong>${formatVND(p.sale_price)}</strong></td>
        <td class="text-right" style="white-space:nowrap;">
          <span class="badge ${p.stock_qty <= 0 ? 'badge-danger' : p.stock_qty <= p.min_stock ? 'badge-warning' : 'badge-success'}">
            ${p.stock_qty} ${p.unit}
          </span>
        </td>
        <td style="white-space:nowrap;">${p.warranty_months}T</td>
        <td style="white-space:nowrap;">
          ${p.is_active !== false ? '<span class="badge badge-success">Đang bán</span>' : '<span class="badge badge-danger">Ngừng bán</span>'}
        </td>
        <td class="text-right">
          <div class="action-btns">
            <button class="btn btn-outline btn-sm" title="Xem chi tiết" onclick='viewProductDetail(${JSON.stringify(p).replace(/'/g, "&#39;")})'>👁️</button>
            ${canEdit ? `<button class="btn btn-outline btn-sm" onclick='openProductModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Sửa</button>` : ''}
            ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.product_id})">Xóa</button>` : ''}
          </div>
        </td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="10">Không có sản phẩm nào phù hợp.</td></tr>';
}

function applyProductFilters() {
  renderProductsTab(
    document.getElementById('prodSearch').value,
    document.getElementById('prodCatFilter').value,
    document.getElementById('prodStockFilter').value,
    document.getElementById('prodSort').value
  );
}

function viewProductDetail(p) {
  openModal(
    `Chi tiết Linh kiện: ${p.sku}`,
    `
    <div style="display:flex; gap:16px; align-items:center; margin-bottom:14px;">
      ${
        p.image_url
          ? `<img src="${p.image_url}" style="width:90px; height:90px; object-fit:cover; border-radius:10px; border:1px solid #e2e8f0;" />`
          : `<div style="width:90px; height:90px; background:#f8fafc; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:38px; border:1px solid #e2e8f0;">🖥️</div>`
      }
      <div>
        <div style="font-size:12px; color:#2563eb; font-weight:700;">${p.brand || 'Chính hãng'} · ${p.category_name}</div>
        <h3 style="font-size:16px; margin:4px 0;">${p.product_name}</h3>
        <div style="font-size:18px; font-weight:700; color:#16a34a;">Giá bán: ${formatVND(p.sale_price)}</div>
      </div>
    </div>
    <table>
      <tr><th>Mã SKU</th><td><code>${p.sku}</code></td></tr>
      <tr><th>Thông số kỹ thuật</th><td>${p.specs || 'Chưa cập nhật'}</td></tr>
      <tr><th>Tồn kho / Tối thiểu</th><td><strong>${p.stock_qty} ${p.unit}</strong> (Mức cảnh báo: ${p.min_stock})</td></tr>
      <tr><th>Bảo hành</th><td>${p.warranty_months} tháng</td></tr>
      <tr><th>Vị trí kệ kho</th><td>${p.shelf_location ? `<button type="button" class="btn btn-outline btn-sm" onclick="openWarehouseMapModal('${p.sku}')" title="Bấm để định vị trên Sơ đồ kho">🗺️ ${p.shelf_location}</button>` : '-'}</td></tr>
      <tr><th>Trạng thái</th><td>${p.is_active !== false ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</td></tr>
    </table>`
  );
}

function exportProductsCSV() {
  if (!cachedProducts.length) return showToast('Không có dữ liệu để xuất.', 'error');
  const includeCost = currentUser.role !== 'BanHang';
  const headers = includeCost
    ? ['SKU', 'Ten san pham', 'Hang', 'Loai hang', 'Gia nhap', 'Gia ban', 'Ton kho', 'Bao hanh (thang)', 'Vi tri ke']
    : ['SKU', 'Ten san pham', 'Hang', 'Loai hang', 'Gia ban', 'Ton kho', 'Bao hanh (thang)', 'Vi tri ke'];
  const lines = [headers.join(',')];
  for (const p of cachedProducts) {
    const row = [
      `"${p.sku}"`,
      `"${(p.product_name || '').replace(/"/g, '""')}"`,
      `"${(p.brand || '').replace(/"/g, '""')}"`,
      `"${(p.category_name || '').replace(/"/g, '""')}"`,
      ...(includeCost ? [p.import_price] : []),
      p.sale_price,
      p.stock_qty,
      p.warranty_months,
      `"${(p.shelf_location || '').replace(/"/g, '""')}"`,
    ];
    lines.push(row.join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Danh_sach_linh_kien_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất file Excel (CSV) thành công!');
}

function openProductModal(p = null) {
  const catOptions = cachedCategories
    .map((c) => `<option value="${c.category_id}" ${p && p.category_id === c.category_id ? 'selected' : ''}>${c.category_name}</option>`)
    .join('');

  openModal(
    p ? 'Cập nhật Linh kiện' : 'Thêm Linh kiện mới',
    `
    <form onsubmit="saveProduct(event, ${p ? p.product_id : 'null'})">
      <div class="form-grid-2">
        <div class="form-group">
          <label>Mã SKU *</label>
          <input type="text" id="fSku" class="form-control" value="${p ? p.sku : ''}" required />
        </div>
        <div class="form-group">
          <label>Loại hàng *</label>
          <select id="fCatId" class="form-control" required>${catOptions}</select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Tên sản phẩm / Linh kiện *</label>
          <input type="text" id="fProdName" class="form-control" value="${p ? p.product_name : ''}" required />
        </div>
        <div class="form-group">
          <label>Hãng sản xuất (Brand)</label>
          <input type="text" id="fBrand" class="form-control" placeholder="VD: ASUS, Intel, MSI, Corsair..." value="${p ? p.brand || '' : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label>Thông số kỹ thuật tóm tắt</label>
        <input type="text" id="fSpecs" class="form-control" placeholder="VD: 8GB GDDR6 | PCIe 4.0 | 2 Quạt..." value="${p ? p.specs || '' : ''}" />
      </div>
      <div class="form-group">
        <label>Ảnh sản phẩm (Chọn file từ máy hoặc dán Link URL)</label>
        <div style="display:flex; gap:10px; align-items:center;">
          <img id="fImgPreview" src="${p && p.image_url ? p.image_url : ''}" style="width:54px; height:54px; object-fit:cover; border-radius:8px; border:1px solid #cbd5e1; display:${p && p.image_url ? 'block' : 'none'};" />
          <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
            <input type="file" id="fImgFile" accept="image/*" class="form-control" style="padding:6px;" onchange="handleProductImageUpload(this)" />
            <input type="text" id="fImgUrl" class="form-control" placeholder="Hoặc dán URL ảnh (https://...)" value="${p && p.image_url ? p.image_url : ''}" oninput="updateImgPreview(this.value)" />
          </div>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Đơn vị tính</label>
          <input type="text" id="fUnit" class="form-control" value="${p ? p.unit : 'Cái'}" required />
        </div>
        <div class="form-group">
          <label>Bảo hành (tháng)</label>
          <input type="number" min="0" id="fWarranty" class="form-control" value="${p ? p.warranty_months : 36}" />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Giá nhập (VNĐ) *</label>
          <input type="number" min="0" id="fImportPrice" class="form-control" value="${p ? p.import_price : 0}" required />
        </div>
        <div class="form-group">
          <label>Giá bán niêm yết (VNĐ) *</label>
          <input type="number" min="0" id="fSalePrice" class="form-control" value="${p ? p.sale_price : 0}" required />
        </div>
      </div>
      ${p ? `
      <div class="form-grid-2">
        <div class="form-group">
          <label>Tồn kho hiện tại (chỉ sửa qua Nhập/Xuất)</label>
          <input type="number" min="0" id="fStockQty" class="form-control" value="${p.stock_qty}" disabled />
        </div>
        <div class="form-group">
          <label>Tồn kho tối thiểu (cảnh báo)</label>
          <input type="number" min="0" id="fMinStock" class="form-control" value="${p.min_stock}" />
        </div>
      </div>` : `
      <div class="form-group">
        <label>Tồn kho tối thiểu (cảnh báo)</label>
        <input type="number" min="0" id="fMinStock" class="form-control" value="5" />
      </div>`}
      <div class="form-grid-2">
        <div class="form-group">
          <label>Vị trí kệ kho</label>
          <input type="text" id="fShelf" list="shelfSuggestions" class="form-control" placeholder="VD: Dãy A - Kệ 1 - Ô 01" value="${p ? p.shelf_location || '' : ''}" />
          <datalist id="shelfSuggestions">
            <option value="Dãy A - Kệ 1 - Ô 01"></option>
            <option value="Dãy A - Kệ 1 - Ô 02"></option>
            <option value="Dãy A - Kệ 1 - Ô 03"></option>
            <option value="Dãy A - Kệ 1 - Ô 04"></option>
            <option value="Dãy B - Kệ 2 - Ô 01"></option>
            <option value="Dãy B - Kệ 2 - Ô 02"></option>
            <option value="Dãy B - Kệ 2 - Ô 03"></option>
            <option value="Dãy B - Kệ 2 - Ô 04"></option>
            <option value="Dãy C - Kệ 1 - Ô 01"></option>
            <option value="Dãy C - Kệ 1 - Ô 02"></option>
            <option value="Dãy C - Kệ 1 - Ô 03"></option>
            <option value="Dãy C - Kệ 2 - Ô 01"></option>
            <option value="Dãy D - Kệ 1 - Ô 01"></option>
            <option value="Dãy D - Kệ 1 - Ô 02"></option>
            <option value="Dãy D - Kệ 1 - Ô 03"></option>
            <option value="Dãy D - Kệ 1 - Ô 04"></option>
          </datalist>
        </div>
        <div class="form-group">
          <label>Trạng thái kinh doanh</label>
          <select id="fProdActive" class="form-control">
            <option value="true" ${!p || p.is_active !== false ? 'selected' : ''}>Đang kinh doanh</option>
            <option value="false" ${p && p.is_active === false ? 'selected' : ''}>Ngừng kinh doanh</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">${p ? 'Lưu thay đổi' : 'Thêm sản phẩm'}</button>
      </div>
    </form>`
  );
}

function updateImgPreview(url) {
  const prev = document.getElementById('fImgPreview');
  if (url && url.trim()) {
    prev.src = url.trim();
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

function handleProductImageUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 400;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      document.getElementById('fImgUrl').value = dataUrl;
      updateImgPreview(dataUrl);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveProduct(e, id) {
  e.preventDefault();
  try {
    const body = {
      sku: document.getElementById('fSku').value,
      category_id: document.getElementById('fCatId').value,
      product_name: document.getElementById('fProdName').value,
      brand: document.getElementById('fBrand').value,
      specs: document.getElementById('fSpecs').value,
      image_url: document.getElementById('fImgUrl').value,
      unit: document.getElementById('fUnit').value,
      warranty_months: document.getElementById('fWarranty').value,
      import_price: document.getElementById('fImportPrice').value,
      sale_price: document.getElementById('fSalePrice').value,
      stock_qty: document.getElementById('fStockQty')?.value ?? 0,
      min_stock: document.getElementById('fMinStock').value,
      shelf_location: document.getElementById('fShelf').value,
      is_active: document.getElementById('fProdActive').value === 'true',
    };
    if (id) await apiFetch(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    showToast(id ? 'Đã cập nhật sản phẩm.' : 'Đã thêm sản phẩm mới.');
    renderProductsTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProduct(id) {
  if (!confirm('Bạn có chắc muốn xóa sản phẩm này?')) return;
  try {
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    showToast('Đã xóa sản phẩm.');
    renderProductsTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 3. QUẢN LÝ KHÁCH HÀNG (CUSTOMERS)
// ============================================================================
const CUST_GROUP_LABELS = {
  KhachLe: '<span class="badge" style="background:#f1f5f9; color:#334155;">Khách lẻ</span>',
  PhongNet: '<span class="badge" style="background:#e0e7ff; color:#3730a3;">Phòng Net / Đại lý</span>',
  DoanhNghiep: '<span class="badge" style="background:#dbeafe; color:#1e40af;">Doanh nghiệp</span>',
};

async function renderCustomersTab(q = '', hasDebt = false, group = '') {
  const canDelete = ['Admin', 'KeToan'].includes(currentUser.role);
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar" style="gap:8px;">
        <div class="search-box" style="max-width:none; flex-wrap:wrap; align-items:center;">
          <input type="text" id="custSearch" class="form-control" style="min-width:200px; flex:1;" placeholder="Tìm tên, SĐT, MST, Email..." value="${q}" onkeydown="if(event.key==='Enter') applyCustomerFilters()" />
          <select id="custGroupFilter" class="form-control" style="max-width:170px;" onchange="applyCustomerFilters()">
            <option value="">Tất cả nhóm KH</option>
            <option value="KhachLe" ${group === 'KhachLe' ? 'selected' : ''}>Khách lẻ</option>
            <option value="PhongNet" ${group === 'PhongNet' ? 'selected' : ''}>Phòng Net / Đại lý</option>
            <option value="DoanhNghiep" ${group === 'DoanhNghiep' ? 'selected' : ''}>Doanh nghiệp</option>
          </select>
          <label style="display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600; color:#b91c1c; cursor:pointer; white-space:nowrap;">
            <input type="checkbox" id="custDebtFilter" ${hasDebt ? 'checked' : ''} onchange="applyCustomerFilters()" />
            Chỉ khách có công nợ (&gt; 0đ)
          </label>
          <button class="btn btn-outline" onclick="applyCustomerFilters()">Tìm</button>
        </div>
        <button class="btn btn-primary" onclick="openCustomerModal()">+ Thêm khách hàng</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Khách hàng & Nhóm</th>
              <th>Liên hệ (SĐT / Email)</th>
              <th>MST</th>
              <th class="text-right">Công nợ (TK 131) / Hạn mức</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="custBody"><tr><td colspan="6">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams({ q, has_debt: hasDebt, customer_group: group });
  const rows = await apiFetch(`/api/customers?${params.toString()}`);
  cachedCustomers = rows;

  document.getElementById('custBody').innerHTML = rows.length
    ? rows
        .map((c) => {
          const isDefault = c.customer_id === 1;
          const hasDebtNow = Number(c.debt_amount) > 0;
          return `
      <tr>
        <td>#${c.customer_id}</td>
        <td>
          <strong>${c.customer_name}</strong>
          <div style="margin-top:3px;">${CUST_GROUP_LABELS[c.customer_group] || ''}</div>
        </td>
        <td>
          <div>${c.phone}</div>
          <small style="color:#64748b;">${c.email || '-'}</small>
        </td>
        <td><code>${c.tax_code || '-'}</code></td>
        <td class="text-right" style="white-space:nowrap;">
          ${hasDebtNow ? `<strong style="color:#dc2626">${formatVND(c.debt_amount)}</strong>` : '0 ₫'}
          <div style="font-size:11px; color:#64748b;">Hạn mức: ${formatVND(c.credit_limit)}</div>
        </td>
        <td class="text-right">
          <div class="action-btns">
            <button class="btn btn-outline btn-sm" onclick="viewCustomerHistory(${c.customer_id})">📜 Lịch sử</button>
            ${hasDebtNow ? `<button class="btn btn-success btn-sm" onclick='openCollectDebtModal(${JSON.stringify(c).replace(/'/g, "&#39;")})'>💰 Thu nợ</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick='openCustomerModal(${JSON.stringify(c).replace(/'/g, "&#39;")})'>Sửa</button>
            ${
              canDelete && !isDefault
                ? `<button class="btn btn-danger btn-sm" ${hasDebtNow ? 'disabled title="Không thể xóa khách đang có công nợ"' : ''} onclick="deleteCustomer(${c.customer_id})">Xóa</button>`
                : ''
            }
          </div>
        </td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="6">Không tìm thấy khách hàng.</td></tr>';
}

function applyCustomerFilters() {
  renderCustomersTab(
    document.getElementById('custSearch').value,
    document.getElementById('custDebtFilter').checked,
    document.getElementById('custGroupFilter').value
  );
}

function openCustomerModal(c = null) {
  openModal(
    c ? 'Cập nhật Khách hàng' : 'Thêm Khách hàng mới',
    `
    <form onsubmit="saveCustomer(event, ${c ? c.customer_id : 'null'})">
      <div class="form-grid-2">
        <div class="form-group">
          <label>Tên khách hàng / Doanh nghiệp *</label>
          <input type="text" id="fCustName" class="form-control" value="${c ? c.customer_name : ''}" required />
        </div>
        <div class="form-group">
          <label>Nhóm khách hàng *</label>
          <select id="fCustGroup" class="form-control">
            <option value="KhachLe" ${!c || c.customer_group === 'KhachLe' ? 'selected' : ''}>Khách lẻ</option>
            <option value="PhongNet" ${c && c.customer_group === 'PhongNet' ? 'selected' : ''}>Phòng Net / Đại lý</option>
            <option value="DoanhNghiep" ${c && c.customer_group === 'DoanhNghiep' ? 'selected' : ''}>Doanh nghiệp</option>
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Số điện thoại * (bắt đầu bằng 0)</label>
          <input type="text" id="fCustPhone" class="form-control" value="${c ? c.phone : ''}" required />
        </div>
        <div class="form-group">
          <label>Email (nhận hóa đơn điện tử)</label>
          <input type="email" id="fCustEmail" class="form-control" placeholder="ketoan@congty.vn" value="${c ? c.email || '' : ''}" />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Mã số thuế (xuất hóa đơn VAT)</label>
          <input type="text" id="fCustTax" class="form-control" placeholder="VD: 0109988776" value="${c ? c.tax_code || '' : ''}" />
        </div>
        <div class="form-group">
          <label>Hạn mức công nợ tối đa (VNĐ)</label>
          <input type="number" min="0" id="fCustLimit" class="form-control" value="${c ? c.credit_limit : 10000000}" />
        </div>
      </div>
      <div class="form-group">
        <label>Địa chỉ</label>
        <input type="text" id="fCustAddr" class="form-control" value="${c ? c.address || '' : ''}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">${c ? 'Lưu thay đổi' : 'Thêm khách hàng'}</button>
      </div>
    </form>`
  );
}

async function saveCustomer(e, id) {
  e.preventDefault();
  try {
    const body = {
      customer_name: document.getElementById('fCustName').value,
      customer_group: document.getElementById('fCustGroup').value,
      phone: document.getElementById('fCustPhone').value,
      email: document.getElementById('fCustEmail').value,
      tax_code: document.getElementById('fCustTax').value,
      credit_limit: document.getElementById('fCustLimit').value,
      address: document.getElementById('fCustAddr').value,
    };
    if (id) await apiFetch(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    showToast(id ? 'Đã cập nhật khách hàng.' : 'Đã thêm khách hàng mới.');
    renderCustomersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function viewCustomerHistory(id) {
  try {
    const data = await apiFetch(`/api/customers/${id}/history`);
    const c = data.customer;
    openModal(
      `Lịch sử Giao dịch & Bảo hành: ${c.customer_name}`,
      `
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; background:#f8fafc; padding:12px; border-radius:8px; margin-bottom:14px;">
        <div><strong>SĐT:</strong> ${c.phone} | <strong>MST:</strong> ${c.tax_code || '-'}</div>
        <div><strong>Nợ hiện tại:</strong> <span style="color:#dc2626; font-weight:700;">${formatVND(c.debt_amount)}</span> / Hạn mức: ${formatVND(c.credit_limit)}</div>
      </div>
      <h4 style="margin-bottom:8px;">🧾 Danh sách Hóa đơn đã lập</h4>
      <div class="table-wrap" style="margin-bottom:16px;">
        <table>
          <thead><tr><th>Số HĐ</th><th>Ngày</th><th class="text-right">Tổng tiền</th><th class="text-right">Đã trả</th><th class="text-right">Còn nợ</th><th>Trạng thái</th></tr></thead>
          <tbody>
            ${
              data.invoices.length
                ? data.invoices
                    .map(
                      (i) => `<tr>
                    <td><strong>${i.invoice_no}</strong></td>
                    <td>${formatDate(i.invoice_date)}</td>
                    <td class="text-right">${formatVND(i.total_amount)}</td>
                    <td class="text-right">${formatVND(i.paid_amount)}</td>
                    <td class="text-right" style="color:${Number(i.debt_amount) > 0 ? '#dc2626' : '#0f172a'};">${formatVND(i.debt_amount)}</td>
                    <td>${STATUS_BADGES[i.payment_status] || i.payment_status}</td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="6">Chưa có hóa đơn nào.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      <h4 style="margin-bottom:8px;">🛡️ Linh kiện đã mua (Tra cứu Bảo hành)</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Số HĐ</th><th>SKU</th><th>Tên linh kiện</th><th class="text-right">SL</th><th>Bảo hành</th></tr></thead>
          <tbody>
            ${
              data.purchasedItems.length
                ? data.purchasedItems
                    .map(
                      (it) => `<tr>
                    <td>${it.invoice_no}</td>
                    <td><code>${it.sku}</code></td>
                    <td>${it.product_name}</td>
                    <td class="text-right">${it.quantity}</td>
                    <td><strong>${it.warranty_months} tháng</strong></td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="5">Chưa có linh kiện nào.</td></tr>'
            }
          </tbody>
        </table>
      </div>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openCollectDebtModal(c) {
  openModal(
    `Thu công nợ (TK 131): ${c.customer_name}`,
    `
    <form onsubmit="submitCollectDebt(event, ${c.customer_id})">
      <p style="margin-bottom:12px;">Công nợ hiện tại: <strong style="color:#dc2626; font-size:16px;">${formatVND(c.debt_amount)}</strong></p>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Số tiền khách trả (VNĐ) *</label>
          <input type="number" min="1" max="${c.debt_amount}" id="fDebtPay" class="form-control" value="${c.debt_amount}" required />
        </div>
        <div class="form-group">
          <label>Hình thức thanh toán</label>
          <select id="fDebtMethod" class="form-control">
            <option value="ChuyenKhoan">Chuyển khoản</option>
            <option value="TienMat">Tiền mặt</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Ghi chú phiếu thu</label>
        <input type="text" id="fDebtNotes" class="form-control" placeholder="VD: Khách chuyển khoản tất toán công nợ..." />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-success">Xác nhận Thu nợ & Lập Phiếu Thu</button>
      </div>
    </form>`
  );
}

async function submitCollectDebt(e, id) {
  e.preventDefault();
  try {
    await apiFetch(`/api/customers/${id}/collect-debt`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(document.getElementById('fDebtPay').value),
        payment_method: document.getElementById('fDebtMethod').value,
        notes: document.getElementById('fDebtNotes').value,
      }),
    });
    closeModal();
    showToast('Đã thu nợ và cập nhật sổ công nợ (TK 131) thành công!');
    applyCustomerFilters();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteCustomer(id) {
  if (!confirm('Bạn có chắc muốn xóa khách hàng này?')) return;
  try {
    await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
    showToast('Đã xóa khách hàng.');
    renderCustomersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 4. QUẢN LÝ NHÀ CUNG CẤP (SUPPLIERS)
// ============================================================================
async function renderSuppliersTab(q = '', hasDebt = false) {
  const canDelete = ['Admin', 'KeToan'].includes(currentUser.role);
  const canPay = ['Admin', 'KeToan'].includes(currentUser.role);

  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar" style="gap:8px;">
        <div class="search-box" style="max-width:none; flex-wrap:wrap; align-items:center;">
          <input type="text" id="supSearch" class="form-control" style="min-width:220px; flex:1;" placeholder="Tìm tên NCC, MST, Sale phụ trách, STK..." value="${q}" onkeydown="if(event.key==='Enter') applySupplierFilters()" />
          <label style="display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600; color:#d97706; cursor:pointer; white-space:nowrap;">
            <input type="checkbox" id="supDebtFilter" ${hasDebt ? 'checked' : ''} onchange="applySupplierFilters()" />
            Chỉ NCC đang có dư nợ (TK 331 &gt; 0)
          </label>
          <button class="btn btn-outline" onclick="applySupplierFilters()">Tìm</button>
        </div>
        <button class="btn btn-primary" onclick="openSupplierModal()">+ Thêm nhà cung cấp</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nhà cung cấp & Sale phụ trách</th>
              <th>SĐT / MST</th>
              <th>Tài khoản ngân hàng</th>
              <th class="text-right">Phải trả (TK 331)</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="supBody"><tr><td colspan="6">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams({ q, has_debt: hasDebt });
  const rows = await apiFetch(`/api/suppliers?${params.toString()}`);
  cachedSuppliers = rows;

  document.getElementById('supBody').innerHTML = rows.length
    ? rows
        .map((s) => {
          const hasDebtNow = Number(s.payable_balance) > 0;
          return `
      <tr>
        <td>#${s.supplier_id}</td>
        <td>
          <strong>${s.supplier_name}</strong>
          <div style="font-size:12px; color:#64748b;">Sale: ${s.sale_contact || 'Chưa cập nhật'}</div>
        </td>
        <td>
          <div>${s.phone}</div>
          <small style="color:#64748b;">MST: <code>${s.tax_code || '-'}</code></small>
        </td>
        <td style="font-size:12px;">${s.bank_account || '-'}</td>
        <td class="text-right" style="white-space:nowrap;">${hasDebtNow ? `<strong style="color:#d97706">${formatVND(s.payable_balance)}</strong>` : '0 ₫'}</td>
        <td class="text-right">
          <div class="action-btns">
            <button class="btn btn-outline btn-sm" onclick="viewSupplierHistory(${s.supplier_id})">📜 Lịch sử</button>
            ${canPay && hasDebtNow ? `<button class="btn btn-warning btn-sm" onclick='openPaySupplierModal(${JSON.stringify(s).replace(/'/g, "&#39;")})'>💸 Trả nợ</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick='openSupplierModal(${JSON.stringify(s).replace(/'/g, "&#39;")})'>Sửa</button>
            ${canDelete ? `<button class="btn btn-danger btn-sm" ${hasDebtNow ? 'disabled title="Không thể xóa NCC đang có dư nợ phải trả"' : ''} onclick="deleteSupplier(${s.supplier_id})">Xóa</button>` : ''}
          </div>
        </td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="6">Không tìm thấy nhà cung cấp.</td></tr>';
}

function applySupplierFilters() {
  renderSuppliersTab(
    document.getElementById('supSearch').value,
    document.getElementById('supDebtFilter').checked
  );
}

function openSupplierModal(s = null) {
  openModal(
    s ? 'Cập nhật Nhà cung cấp' : 'Thêm Nhà cung cấp mới',
    `
    <form onsubmit="saveSupplier(event, ${s ? s.supplier_id : 'null'})">
      <div class="form-group">
        <label>Tên nhà cung cấp / Nhà phân phối *</label>
        <input type="text" id="fSupName" class="form-control" value="${s ? s.supplier_name : ''}" required />
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Số điện thoại tổng đài *</label>
          <input type="text" id="fSupPhone" class="form-control" value="${s ? s.phone : ''}" required />
        </div>
        <div class="form-group">
          <label>Mã số thuế</label>
          <input type="text" id="fSupTax" class="form-control" value="${s ? s.tax_code || '' : ''}" />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Sale phụ trách (Tên & SĐT/Zalo)</label>
          <input type="text" id="fSupSale" class="form-control" placeholder="VD: Anh Dũng - 0908111222" value="${s ? s.sale_contact || '' : ''}" />
        </div>
        <div class="form-group">
          <label>Tài khoản ngân hàng (STK + Ngân hàng)</label>
          <input type="text" id="fSupBank" class="form-control" placeholder="VD: 19033445566 - Techcombank" value="${s ? s.bank_account || '' : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label>Địa chỉ trụ sở chính</label>
        <input type="text" id="fSupAddr" class="form-control" value="${s ? s.address || '' : ''}" />
      </div>
      <div class="form-group">
        <label>Địa chỉ Trung tâm Bảo hành (RMA)</label>
        <input type="text" id="fSupRma" class="form-control" placeholder="VD: 162B Bùi Thị Xuân, Q.1, TP.HCM" value="${s ? s.rma_address || '' : ''}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">${s ? 'Lưu thay đổi' : 'Thêm NCC'}</button>
      </div>
    </form>`
  );
}

async function saveSupplier(e, id) {
  e.preventDefault();
  try {
    const body = {
      supplier_name: document.getElementById('fSupName').value,
      phone: document.getElementById('fSupPhone').value,
      tax_code: document.getElementById('fSupTax').value,
      sale_contact: document.getElementById('fSupSale').value,
      bank_account: document.getElementById('fSupBank').value,
      address: document.getElementById('fSupAddr').value,
      rma_address: document.getElementById('fSupRma').value,
    };
    if (id) await apiFetch(`/api/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    showToast(id ? 'Đã cập nhật nhà cung cấp.' : 'Đã thêm nhà cung cấp mới.');
    renderSuppliersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function viewSupplierHistory(id) {
  try {
    const data = await apiFetch(`/api/suppliers/${id}/history`);
    const s = data.supplier;
    openModal(
      `Hồ sơ & Lịch sử nhập hàng: ${s.supplier_name}`,
      `
      <div style="background:#f8fafc; padding:12px; border-radius:8px; margin-bottom:14px; font-size:13px;">
        <div><strong>Sale phụ trách:</strong> ${s.sale_contact || '-'} | <strong>TTBH (RMA):</strong> ${s.rma_address || '-'}</div>
        <div style="margin-top:4px;"><strong>STK Ngân hàng:</strong> ${s.bank_account || '-'}</div>
        <div style="margin-top:4px;"><strong>Dư nợ Phải trả (TK 331):</strong> <span style="color:#d97706; font-weight:700;">${formatVND(s.payable_balance)}</span></div>
      </div>
      <h4 style="margin-bottom:8px;">📥 Danh sách Phiếu nhập hàng từ NCC</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Số phiếu</th><th>Ngày nhập</th><th>Người lập</th><th class="text-right">Tổng tiền</th><th class="text-right">Đã trả</th><th class="text-right">Còn nợ</th></tr></thead>
          <tbody>
            ${
              data.receipts.length
                ? data.receipts
                    .map(
                      (r) => `<tr>
                    <td><strong>${r.receipt_no}</strong></td>
                    <td>${formatDate(r.receipt_date)}</td>
                    <td>${r.staff_name}</td>
                    <td class="text-right">${formatVND(r.total_amount)}</td>
                    <td class="text-right">${formatVND(r.paid_amount)}</td>
                    <td class="text-right" style="color:${Number(r.total_amount) - Number(r.paid_amount) > 0 ? '#d97706' : '#0f172a'}; font-weight:600;">
                      ${formatVND(Number(r.total_amount) - Number(r.paid_amount))}
                    </td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="6">Chưa có phiếu nhập hàng nào.</td></tr>'
            }
          </tbody>
        </table>
      </div>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openPaySupplierModal(s) {
  openModal(
    `Lập Phiếu Chi trả nợ NCC (TK 331): ${s.supplier_name}`,
    `
    <form onsubmit="submitPaySupplier(event, ${s.supplier_id})">
      <div style="background:#fffbeb; border:1px solid #fde68a; padding:10px 12px; border-radius:8px; margin-bottom:12px; font-size:13px;">
        <div><strong>Dư nợ phải trả:</strong> <span style="color:#d97706; font-size:15px; font-weight:700;">${formatVND(s.payable_balance)}</span></div>
        <div><strong>STK nhận tiền:</strong> ${s.bank_account || 'Chưa lưu STK'}</div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Số tiền thanh toán (VNĐ) *</label>
          <input type="number" min="1" max="${s.payable_balance}" id="fSupPayAmt" class="form-control" value="${s.payable_balance}" required />
        </div>
        <div class="form-group">
          <label>Hình thức thanh toán</label>
          <select id="fSupPayMethod" class="form-control">
            <option value="ChuyenKhoan">Chuyển khoản ngân hàng</option>
            <option value="TienMat">Tiền mặt</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Nội dung Phiếu Chi</label>
        <input type="text" id="fSupPayNotes" class="form-control" placeholder="VD: Chuyển khoản thanh toán công nợ nhập hàng..." />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-warning">Xác nhận Trả nợ & Lập Phiếu Chi</button>
      </div>
    </form>`
  );
}

async function submitPaySupplier(e, id) {
  e.preventDefault();
  try {
    await apiFetch(`/api/suppliers/${id}/pay-debt`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(document.getElementById('fSupPayAmt').value),
        payment_method: document.getElementById('fSupPayMethod').value,
        notes: document.getElementById('fSupPayNotes').value,
      }),
    });
    closeModal();
    showToast('Đã lập Phiếu Chi trả nợ NCC (TK 331) thành công!');
    applySupplierFilters();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteSupplier(id) {
  if (!confirm('Bạn có chắc muốn xóa nhà cung cấp này?')) return;
  try {
    await apiFetch(`/api/suppliers/${id}`, { method: 'DELETE' });
    showToast('Đã xóa nhà cung cấp.');
    renderSuppliersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 5. QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN (USERS - ADMIN)
// ============================================================================
async function renderUsersTab(q = '') {
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="search-box">
          <input type="text" id="userSearch" class="form-control" placeholder="Tìm theo username, họ tên, vai trò..." value="${q}" onkeydown="if(event.key==='Enter') renderUsersTab(this.value)" />
          <button class="btn btn-outline" onclick="renderUsersTab(document.getElementById('userSearch').value)">Tìm</button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline" onclick="openRoleMatrixModal()">🛡️ Ma trận phân quyền</button>
          <button class="btn btn-primary" onclick="openUserModal()">+ Thêm tài khoản</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Tên đăng nhập</th>
              <th>Họ và tên</th>
              <th>Vai trò</th>
              <th>Số điện thoại</th>
              <th>Đăng nhập lần cuối</th>
              <th>Trạng thái</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="userBody"><tr><td colspan="8">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const rows = await apiFetch(`/api/users?q=${encodeURIComponent(q)}`);
  document.getElementById('userBody').innerHTML = rows.length
    ? rows
        .map((u) => {
          const isProtected = u.user_id === 1 || u.user_id === currentUser.user_id;
          return `
      <tr>
        <td>#${u.user_id}</td>
        <td>
          <strong>${u.username}</strong>
          ${u.user_id === 1 ? ' <span class="badge" style="background:#fef3c7; color:#92400e;">Admin gốc</span>' : ''}
        </td>
        <td>${u.full_name}</td>
        <td><span class="role-badge">${ROLE_LABELS[u.role] || u.role}</span></td>
        <td>${u.phone || '-'}</td>
        <td style="font-size:12px; color:#64748b;">${u.last_login ? formatDate(u.last_login) : 'Chưa đăng nhập'}</td>
        <td>${u.is_active ? '<span class="badge badge-success">Hoạt động</span>' : '<span class="badge badge-danger">Đã khóa</span>'}</td>
        <td class="text-right">
          <div class="action-btns">
            <button class="btn btn-outline btn-sm" title="Reset mật khẩu về 123456" onclick="resetUserPassword(${u.user_id}, '${u.username}')">🔑 Reset MK</button>
            <button class="btn btn-outline btn-sm" onclick='openUserModal(${JSON.stringify(u).replace(/'/g, "&#39;")})'>Sửa</button>
            ${
              isProtected
                ? `<button class="btn btn-outline btn-sm" disabled title="Tài khoản được bảo vệ">🔒 Bảo vệ</button>`
                : u.has_docs
                  ? `<button class="btn btn-warning btn-sm" title="Nhân viên đã lập chứng từ - Khóa mềm thay vì xóa" onclick="toggleUserActive(${u.user_id})">${u.is_active ? '🔒 Khóa' : '🔓 Mở'}</button>`
                  : `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.user_id})">Xóa</button>`
            }
          </div>
        </td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="8">Không tìm thấy tài khoản nào.</td></tr>';
}

function openRoleMatrixModal() {
  openModal(
    'Ma trận Phân quyền Hệ thống (RBAC)',
    `
    <p style="font-size:13px; color:#64748b; margin-bottom:12px;">
      Hệ thống kiểm soát chặt chẽ quyền truy cập theo từng vị trí công việc ở cả giao diện lẫn API Backend:
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Phân hệ / Chức năng</th>
            <th>Quản lý (Admin)</th>
            <th>Kế toán viên</th>
            <th>Bán hàng</th>
            <th>Thủ kho</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><strong>Trang chủ (Dashboard)</strong></td><td>Toàn quyền</td><td>Toàn quyền</td><td>Xem hạn chế (<strong>Ẩn giá vốn, TK 331</strong>)</td><td>Xem hạn chế (Cảnh báo kho)</td></tr>
          <tr><td><strong>Sản phẩm & Giá vốn</strong></td><td>Toàn quyền</td><td>Toàn quyền (Thêm/Sửa/Xóa)</td><td>Chỉ xem (<strong>Ẩn giá nhập</strong>)</td><td>Thêm/Sửa & Gán kệ</td></tr>
          <tr><td><strong>Loại hàng</strong></td><td>Toàn quyền</td><td>Toàn quyền</td><td>Ẩn</td><td>Xem/Thêm/Sửa</td></tr>
          <tr><td><strong>Khách hàng & TK 131</strong></td><td>Toàn quyền</td><td>Toàn quyền & Thu nợ</td><td>Thêm/Sửa & Thu nợ</td><td>Ẩn</td></tr>
          <tr><td><strong>Nhà cung cấp & TK 331</strong></td><td>Toàn quyền</td><td>Toàn quyền & Trả nợ</td><td>Ẩn</td><td>Xem/Thêm/Sửa</td></tr>
          <tr><td><strong>Nhập hàng (Mua hàng)</strong></td><td>Toàn quyền</td><td>Lập, Xem & Thanh toán</td><td>Ẩn</td><td>Lập phiếu & <strong>Duyệt nhập kho</strong></td></tr>
          <tr><td><strong>Bán hàng (Hóa đơn)</strong></td><td>Toàn quyền</td><td>Lập, Xem & Thu tiền</td><td>Lập, Xem & Thu tiền</td><td>Kiểm nhận hàng Đổi/Trả</td></tr>
          <tr><td><strong>Kho & Sơ đồ kệ</strong></td><td>Toàn quyền</td><td>Xem tồn & Thẻ kho</td><td>Xem tồn & Thẻ kho</td><td>Quản lý tồn & Chuyển kệ</td></tr>
          <tr><td><strong>Kiểm kê kho</strong></td><td>Toàn quyền</td><td>Xem & Lập phiếu</td><td>Ẩn</td><td>Xem & Lập phiếu</td></tr>
          <tr><td><strong>Bảo hành linh kiện (RMA)</strong></td><td>Toàn quyền</td><td>Ẩn</td><td>Tra cứu & Tiếp nhận BH</td><td>Tra cứu & Xử lý RMA</td></tr>
          <tr><td><strong>Quỹ & Sổ Thu/Chi (PT/PC)</strong></td><td>Toàn quyền</td><td>Toàn quyền</td><td>Ẩn</td><td>Ẩn</td></tr>
          <tr><td><strong>Báo cáo kế toán</strong></td><td>Toàn quyền</td><td>Toàn quyền</td><td>Ẩn</td><td>Ẩn</td></tr>
          <tr><td><strong>Nhân viên & Phân quyền</strong></td><td>Toàn quyền</td><td>Ẩn</td><td>Ẩn</td><td>Ẩn</td></tr>
        </tbody>
      </table>
    </div>`,
    true
  );
}

async function resetUserPassword(id, username) {
  if (!confirm(`Đặt lại mật khẩu tài khoản "${username}" về mặc định (123456)?`)) return;
  try {
    const res = await apiFetch(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: '123456' }),
    });
    showToast(res.message);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleUserActive(id) {
  try {
    const res = await apiFetch(`/api/users/${id}/toggle-active`, { method: 'POST' });
    showToast(res.message);
    renderUsersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openUserModal(u = null) {
  openModal(
    u ? `Cập nhật Tài khoản: ${u.username}` : 'Thêm Tài khoản Nhân viên',
    `
    <form onsubmit="saveUser(event, ${u ? u.user_id : 'null'})">
      ${
        u
          ? ''
          : `<div class="form-group">
              <label>Tên đăng nhập *</label>
              <input type="text" id="fUsername" class="form-control" required />
             </div>`
      }
      <div class="form-group">
        <label>Họ và tên *</label>
        <input type="text" id="fFullName" class="form-control" value="${u ? u.full_name : ''}" required />
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Vai trò phân quyền *</label>
          <select id="fUserRole" class="form-control">
            <option value="Admin" ${u && u.role === 'Admin' ? 'selected' : ''}>Quản lý (Admin)</option>
            <option value="KeToan" ${u && u.role === 'KeToan' ? 'selected' : ''}>Kế toán viên</option>
            <option value="BanHang" ${u && u.role === 'BanHang' ? 'selected' : ''}>Nhân viên Bán hàng</option>
            <option value="ThuKho" ${u && u.role === 'ThuKho' ? 'selected' : ''}>Thủ kho & Kỹ thuật</option>
          </select>
        </div>
        <div class="form-group">
          <label>Số điện thoại</label>
          <input type="text" id="fUserPhone" class="form-control" value="${u ? u.phone || '' : ''}" />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>${u ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu * (>= 6 ký tự)'}</label>
          <input type="password" id="fPassword" class="form-control" ${u ? '' : 'required minlength="6"'} />
        </div>
        ${
          u
            ? `<div class="form-group">
                <label>Trạng thái</label>
                <select id="fActive" class="form-control">
                  <option value="true" ${u.is_active ? 'selected' : ''}>Hoạt động</option>
                  <option value="false" ${!u.is_active ? 'selected' : ''}>Khóa tài khoản</option>
                </select>
               </div>`
            : ''
        }
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">${u ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>
      </div>
    </form>`
  );
}

async function saveUser(e, id) {
  e.preventDefault();
  try {
    const body = {
      full_name: document.getElementById('fFullName').value,
      role: document.getElementById('fUserRole').value,
      phone: document.getElementById('fUserPhone').value,
      password: document.getElementById('fPassword').value,
    };
    if (id) {
      body.is_active = document.getElementById('fActive').value === 'true';
      await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      body.username = document.getElementById('fUsername').value;
      await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(body) });
    }
    closeModal();
    showToast(id ? 'Đã cập nhật tài khoản.' : 'Đã tạo tài khoản mới.');
    renderUsersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Bạn có chắc muốn xóa tài khoản này?')) return;
  try {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    showToast('Đã xóa tài khoản.');
    renderUsersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 6. MODULE MUA HÀNG (NHẬP KHO NHIỀU DÒNG + SERIAL + DUYỆT KHO + IN PHIẾU)
// ============================================================================
async function renderPurchaseTab(q = '', fromDate = '', toDate = '', unpaidOnly = false) {
  const canConfirmWh = ['Admin', 'ThuKho'].includes(currentUser.role);
  const canPay = ['Admin', 'KeToan'].includes(currentUser.role);
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar" style="gap:8px;">
        <div class="search-box" style="max-width:none; flex-wrap:wrap; align-items:center;">
          <input type="text" id="purSearch" class="form-control" style="min-width:190px; flex:1;" placeholder="Tìm số phiếu, HĐ VAT, tên NCC..." value="${q}" onkeydown="if(event.key==='Enter') applyPurchaseFilters()" />
          <input type="date" id="purFrom" class="form-control" style="max-width:145px;" title="Từ ngày" value="${fromDate}" />
          <input type="date" id="purTo" class="form-control" style="max-width:145px;" title="Đến ngày" value="${toDate}" />
          <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:600; color:#d97706; cursor:pointer; white-space:nowrap;">
            <input type="checkbox" id="purUnpaid" ${unpaidOnly ? 'checked' : ''} onchange="applyPurchaseFilters()" />
            Chưa thanh toán đủ
          </label>
          <button class="btn btn-outline" onclick="applyPurchaseFilters()">Lọc</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openWarehouseMapModal()">🗺️ Sơ đồ kho</button>
          <button class="btn btn-primary" onclick="openCreatePurchaseModal()">+ Lập phiếu nhập hàng</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Số phiếu / HĐ VAT</th>
              <th>Ngày nhập</th>
              <th>Nhà cung cấp</th>
              <th>Người lập</th>
              <th class="text-right">Tổng tiền</th>
              <th class="text-right">Đã trả / Còn nợ</th>
              <th>Trạng thái TT & Kho</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="purBody"><tr><td colspan="8">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams({ q, from_date: fromDate, to_date: toDate, unpaid_only: unpaidOnly });
  const rows = await apiFetch(`/api/purchases?${params.toString()}`);

  document.getElementById('purBody').innerHTML = rows.length
    ? rows
        .map((r) => {
          const debt = Number(r.total_amount) - Number(r.paid_amount);
          const payBadge =
            debt <= 0
              ? '<span class="badge badge-success">Đã thanh toán</span>'
              : Number(r.paid_amount) === 0
                ? '<span class="badge badge-danger">Ghi nợ NCC</span>'
                : '<span class="badge badge-warning">Thanh toán 1 phần</span>';
          const whBadge =
            r.warehouse_status === 'DaNhapKho'
              ? '<span class="badge badge-success">Đã nhập kho</span>'
              : '<span class="badge badge-warning">Chờ nhập kho</span>';

          return `
      <tr>
        <td>
          <strong>${r.receipt_no}</strong>
          ${r.supplier_invoice_no ? `<div style="font-size:11px; color:#64748b;">VAT: <code>${r.supplier_invoice_no}</code></div>` : ''}
        </td>
        <td style="font-size:12px;">${formatDate(r.receipt_date)}</td>
        <td>${r.supplier_name}</td>
        <td>${r.staff_name}</td>
        <td class="text-right" style="white-space:nowrap;"><strong>${formatVND(r.total_amount)}</strong></td>
        <td class="text-right" style="white-space:nowrap;">
          <div>Đã trả: ${formatVND(r.paid_amount)}</div>
          <div style="font-size:12px; color:${debt > 0 ? '#dc2626' : '#64748b'}; font-weight:${debt > 0 ? '700' : '400'};">
            Còn nợ: ${formatVND(debt)}
          </div>
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
            ${payBadge}
            ${whBadge}
          </div>
        </td>
        <td class="text-right">
          <div class="action-btns">
            ${canConfirmWh && r.warehouse_status === 'ChoNhapKho' ? `<button class="btn btn-success btn-sm" onclick="confirmWarehouseReceipt(${r.receipt_id})">✅ Duyệt kho</button>` : ''}
            ${canPay && debt > 0 ? `<button class="btn btn-warning btn-sm" onclick="openPayPurchaseReceiptModal(${r.receipt_id}, '${r.receipt_no}', '${(r.supplier_name || '').replace(/'/g, "\\'")}', ${debt})">💸 Trả nợ</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="viewPurchaseDetail(${r.receipt_id})">Xem</button>
            <button class="btn btn-outline btn-sm" onclick="printPurchaseReceipt(${r.receipt_id})">🖨️ In</button>
          </div>
        </td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="8">Chưa có phiếu nhập hàng nào.</td></tr>';
}

function applyPurchaseFilters() {
  renderPurchaseTab(
    document.getElementById('purSearch').value,
    document.getElementById('purFrom').value,
    document.getElementById('purTo').value,
    document.getElementById('purUnpaid').checked
  );
}

async function confirmWarehouseReceipt(id, fromInventory = false) {
  try {
    const r = await apiFetch(`/api/purchases/${id}`);
    const allSlots = WAREHOUSE_AISLES.flatMap((a) => a.slots);
    openModal(
      `🔍 Kiểm đếm & Xếp hàng lên kệ — ${r.receipt_no}`,
      `
      <div style="background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:13px; border:1px solid #e2e8f0;">
        <div><strong>Nhà cung cấp:</strong> ${r.supplier_name} | <strong>Ngày lập:</strong> ${formatDate(r.receipt_date)}</div>
        <div style="color:#b45309; margin-top:4px;">⏳ Vui lòng kiểm đếm thực tế số lượng linh kiện, nhập Serial (nếu có) và chọn vị trí kệ để xếp hàng lên kho:</div>
      </div>
      <form onsubmit="submitConfirmWarehouse(event, ${id}, ${fromInventory})">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Tên linh kiện</th>
                <th class="text-right">SL nhập</th>
                <th>Serial nhập (S/N, nếu có)</th>
                <th>Vị trí kệ xếp hàng</th>
              </tr>
            </thead>
            <tbody>
              ${r.items
                .map((it) => {
                  const existingSns = (r.serials || [])
                    .filter((s) => Number(s.product_id) === Number(it.product_id))
                    .map((s) => s.serial_number);
                  const remainQty = Math.max(0, Number(it.quantity) - existingSns.length);
                  return `
                <tr>
                  <td><code>${it.sku}</code></td>
                  <td><strong>${it.product_name}</strong></td>
                  <td class="text-right"><strong>+${it.quantity}</strong> ${it.unit}</td>
                  <td>
                    ${existingSns.length ? `<div style="font-size:11px; color:#059669; margin-bottom:4px;">Đã có ${existingSns.length} S/N: ${existingSns.join(', ')}</div>` : ''}
                    ${remainQty > 0 ? `<input type="text" class="form-control wh-assign-serials" data-pid="${it.product_id}" placeholder="Thêm tối đa ${remainQty} S/N cách dấu phẩy..." />` : '<span style="font-size:11px; color:#64748b;">Đã đủ S/N</span>'}
                  </td>
                  <td>
                    <select class="form-control wh-assign-shelf" data-pid="${it.product_id}">
                      ${allSlots.map((s) => `<option value="${s}" ${s === it.shelf_location ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                  </td>
                </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="modal-footer" style="margin-top:14px;">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
          <button type="submit" class="btn btn-success">✅ Xác nhận đã kiểm & Đưa hàng lên kệ</button>
        </div>
      </form>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitConfirmWarehouse(e, id, fromInventory = false) {
  e.preventDefault();
  const shelf_assignments = [...document.querySelectorAll('.wh-assign-shelf')].map((sel) => ({
    product_id: Number(sel.getAttribute('data-pid')),
    shelf_location: sel.value,
  }));
  const serial_assignments = [...document.querySelectorAll('.wh-assign-serials')]
    .map((inp) => ({
      product_id: Number(inp.getAttribute('data-pid')),
      serials: inp.value.trim(),
    }))
    .filter((x) => x.serials.length > 0);
  try {
    const res = await apiFetch(`/api/purchases/${id}/confirm-warehouse`, {
      method: 'POST',
      body: JSON.stringify({ shelf_assignments, serial_assignments }),
    });
    closeModal();
    showToast(res.message);
    if (fromInventory) {
      renderInventoryTab(document.getElementById('invtSearch')?.value || '', document.getElementById('invtStatus')?.value || 'all');
    } else if (typeof applyPurchaseFilters === 'function' && document.getElementById('purBody')) {
      applyPurchaseFilters();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openPayPurchaseReceiptModal(receiptId, receiptNo, supplierName, debtAmount) {
  openModal(
    `💸 Trả nợ Phiếu nhập — ${receiptNo}`,
    `
    <form onsubmit="submitPayPurchaseReceipt(event, ${receiptId})">
      <div style="background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:14px; border:1px solid #e2e8f0;">
        <div><strong>Nhà cung cấp:</strong> ${supplierName}</div>
        <div style="display:flex; justify-content:space-between; font-size:14px; margin-top:6px;">
          <span>Số tiền còn nợ NCC (TK 331):</span>
          <strong style="color:#dc2626;">${formatVND(debtAmount)}</strong>
        </div>
      </div>
      <div class="form-group">
        <label>Số tiền chi trả (VNĐ) *</label>
        <input type="number" id="payPurAmount" class="form-control" min="1000" max="${debtAmount}" value="${debtAmount}" required />
      </div>
      <div class="form-group">
        <label>Hình thức thanh toán *</label>
        <select id="payPurMethod" class="form-control">
          <option value="ChuyenKhoan" selected>🏦 Chuyển khoản ngân hàng</option>
          <option value="TienMat">💵 Tiền mặt</option>
          <option value="QuetThe">💳 Quẹt thẻ</option>
        </select>
      </div>
      <div class="form-group">
        <label>Ghi chú phiếu chi</label>
        <input type="text" id="payPurNotes" class="form-control" value="Thanh toán nợ phiếu nhập ${receiptNo}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-warning">💸 Xác nhận & Lập Phiếu chi</button>
      </div>
    </form>`
  );
}

async function submitPayPurchaseReceipt(e, receiptId) {
  e.preventDefault();
  try {
    const res = await apiFetch(`/api/purchases/${receiptId}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(document.getElementById('payPurAmount').value),
        payment_method: document.getElementById('payPurMethod').value,
        notes: document.getElementById('payPurNotes').value,
      }),
    });
    closeModal();
    showToast(`${res.message} (${res.payment_no})`);
    applyPurchaseFilters();
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function viewPurchaseDetail(id) {
  try {
    const r = await apiFetch(`/api/purchases/${id}`);
    const debt = Number(r.total_amount) - Number(r.paid_amount);
    openModal(
      `Chi tiết Phiếu nhập ${r.receipt_no}`,
      `
      <div style="background:#f8fafc; padding:12px; border-radius:8px; margin-bottom:12px; font-size:13px;">
        <div><strong>Nhà cung cấp:</strong> ${r.supplier_name} (${r.supplier_phone})</div>
        <div style="margin-top:4px;"><strong>Số HĐ VAT NCC:</strong> <code>${r.supplier_invoice_no || 'Không có'}</code> | <strong>Trạng thái kho:</strong> ${r.warehouse_status === 'DaNhapKho' ? 'Đã nhập kho' : 'Chờ kiểm đếm'}</div>
        <div style="margin-top:4px;"><strong>Ngày lập:</strong> ${formatDate(r.receipt_date)} | <strong>Người lập:</strong> ${r.staff_name}</div>
      </div>
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th>SKU</th><th>Sản phẩm</th><th class="text-right">SL</th><th class="text-right">Đơn giá nhập</th><th class="text-right">Thành tiền</th></tr></thead>
          <tbody>
            ${r.items
              .map(
                (it) => `<tr>
                <td><code>${it.sku}</code></td>
                <td>${it.product_name}</td>
                <td class="text-right">${it.quantity}</td>
                <td class="text-right">${formatVND(it.import_price)}</td>
                <td class="text-right"><strong>${formatVND(it.line_total)}</strong></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        r.serials && r.serials.length
          ? `<div style="margin-top:14px;">
              <strong style="font-size:13px;">🏷️ Danh sách Serial (S/N) đã ghi nhận theo phiếu:</strong>
              <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
                ${r.serials.map((s) => `<span class="badge" style="background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1;">${s.sku}: <code>${s.serial_number}</code></span>`).join('')}
              </div>
             </div>`
          : ''
      }
      <div class="summary-box">
        <div class="summary-row total"><span>Tổng tiền phiếu nhập:</span><span>${formatVND(r.total_amount)}</span></div>
        <div class="summary-row"><span>Đã thanh toán NCC:</span><span>${formatVND(r.paid_amount)}</span></div>
        <div class="summary-row"><span>Còn nợ NCC (TK 331):</span><strong style="color:${debt > 0 ? '#dc2626' : '#16a34a'};">${formatVND(debt)}</strong></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="printPurchaseReceipt(${r.receipt_id})">🖨️ In Phiếu Nhập Kho</button>
        <button type="button" class="btn btn-primary" onclick="closeModal()">Đóng</button>
      </div>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function printPurchaseReceipt(id) {
  try {
    const r = await apiFetch(`/api/purchases/${id}`);
    const win = window.open('', '_blank', 'width=850,height=700');
    win.document.write(`
      <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Phiếu Nhập Kho ${r.receipt_no}</title>
      <style>
        body { font-family: 'Times New Roman', serif; padding: 30px; color: #000; }
        .head { display: flex; justify-content: space-between; margin-bottom: 18px; }
        h2 { text-align: center; margin: 10px 0 4px; text-transform: uppercase; }
        .sub { text-align: center; font-style: italic; margin-bottom: 18px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
        th, td { border: 1px solid #333; padding: 7px 9px; }
        th { background: #f1f5f9; }
        .right { text-align: right; }
        .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-top: 34px; font-size: 13px; }
      </style></head><body>
      <div class="head">
        <div><strong>CỬA HÀNG LINH KIỆN FAST COMPUTER</strong><br>Showroom: Hà Nội | MST: 0108889990</div>
        <div><strong>Mẫu số 01 - VT</strong><br>Số phiếu: <strong>${r.receipt_no}</strong></div>
      </div>
      <h2>PHIẾU NHẬP KHO</h2>
      <div class="sub">Ngày lập: ${formatDate(r.receipt_date)} | HĐ VAT NCC: ${r.supplier_invoice_no || '---'}</div>
      <p><strong>Nhà cung cấp:</strong> ${r.supplier_name} — ĐT: ${r.supplier_phone}</p>
      <p><strong>Địa chỉ:</strong> ${r.supplier_address || '---'} | <strong>Ghi chú:</strong> ${r.notes || 'Nhập hàng kinh doanh'}</p>
      <table>
        <thead><tr><th>STT</th><th>Mã SKU</th><th>Tên linh kiện</th><th>ĐVT</th><th class="right">SL</th><th class="right">Đơn giá</th><th class="right">Thành tiền</th></tr></thead>
        <tbody>
          ${r.items
            .map(
              (it, idx) => `<tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td>${it.sku}</td>
              <td>${it.product_name}</td>
              <td style="text-align:center;">${it.unit}</td>
              <td class="right">${it.quantity}</td>
              <td class="right">${formatVND(it.import_price)}</td>
              <td class="right"><strong>${formatVND(it.line_total)}</strong></td>
            </tr>`
            )
            .join('')}
          <tr><td colspan="6" class="right"><strong>Tổng cộng tiền hàng:</strong></td><td class="right"><strong>${formatVND(r.total_amount)}</strong></td></tr>
          <tr><td colspan="6" class="right">Đã thanh toán cho NCC:</td><td class="right">${formatVND(r.paid_amount)}</td></tr>
          <tr><td colspan="6" class="right">Còn nợ NCC (TK 331):</td><td class="right"><strong>${formatVND(Number(r.total_amount) - Number(r.paid_amount))}</strong></td></tr>
        </tbody>
      </table>
      <div class="sigs">
        <div><strong>Người lập phiếu (Kế toán)</strong><br><em>(Ký, họ tên)</em><br><br><br>${r.staff_name}</div>
        <div><strong>Người giao hàng</strong><br><em>(Ký, họ tên)</em></div>
        <div><strong>Thủ kho</strong><br><em>(Ký, họ tên)</em></div>
      </div>
      <script>window.onload = () => window.print();</script>
      </body></html>
    `);
    win.document.close();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openCreatePurchaseModal(preselectProductId = null) {
  const [suppliers, products] = await Promise.all([apiFetch('/api/suppliers'), apiFetch('/api/products?lite=1')]);
  cachedSuppliers = suppliers;
  cachedProducts = products;

  openModal(
    'Lập Phiếu Nhập Hàng Mới',
    `
    <form id="purchaseForm" onsubmit="submitPurchase(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label>Nhà cung cấp *</label>
          <select id="purSupplier" class="form-control" required>
            ${suppliers.map((s) => `<option value="${s.supplier_id}">${s.supplier_name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Số hóa đơn VAT của NCC</label>
          <input type="text" id="purVatNo" class="form-control" placeholder="VD: VS-001290, SY-008842..." />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Quy trình nhập kho</label>
          <select id="purWhStatus" class="form-control">
            <option value="ChoNhapKho" selected>Chờ Thủ kho kiểm đếm & Lên kệ (Chưa cộng tồn)</option>
            <option value="DaNhapKho">Đã kiểm đếm & Nhập kho ngay (Cộng tồn)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Hình thức thanh toán</label>
          <select id="purMethod" class="form-control">
            <option value="ChuyenKhoan">Chuyển khoản</option>
            <option value="TienMat">Tiền mặt</option>
          </select>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin:10px 0 8px;">
        <strong>Danh sách linh kiện nhập kho</strong>
        <button type="button" class="btn btn-success btn-sm" onclick="addPurchaseRow()">+ Thêm dòng sản phẩm</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sản phẩm / Linh kiện</th>
              <th style="width:75px;">SL</th>
              <th style="width:130px;">Đơn giá nhập</th>
              <th style="width:170px;">Serial / S/N (cách dấu phẩy)</th>
              <th class="text-right" style="width:120px;">Thành tiền</th>
              <th style="width:40px;"></th>
            </tr>
          </thead>
          <tbody id="purItemsBody"></tbody>
        </table>
      </div>

      <div class="summary-box">
        <div class="summary-row total"><span>Tổng tiền phiếu nhập:</span><span id="purGrandTotal">0 ₫</span></div>
        <div class="form-grid-2" style="margin-top:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label>Số tiền đã thanh toán NCC (VNĐ)</label>
            <input type="number" min="0" id="purPaid" class="form-control" value="0" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Ghi chú</label>
            <input type="text" id="purNotes" class="form-control" placeholder="VD: Nhập lô hàng tháng 11..." />
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Lưu Phiếu Nhập Hàng</button>
      </div>
    </form>`,
    true
  );
  addPurchaseRow();
  if (preselectProductId) {
    const firstSel = document.querySelector('#purItemsBody .pur-prod');
    if (firstSel) {
      firstSel.value = String(preselectProductId);
      onPurchaseProdChange(firstSel);
    }
  }
}

function addPurchaseRow() {
  const tbody = document.getElementById('purItemsBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input type="text" class="form-control pur-prod-search" style="margin-bottom:5px; font-size:12px; padding:5px 8px;" placeholder="🔍 Gõ SKU / tên để lọc..." oninput="filterPurchaseProdSelect(this)" />
      <select class="form-control pur-prod" onchange="onPurchaseProdChange(this)">
        ${cachedProducts.map((p) => `<option value="${p.product_id}" data-price="${p.import_price}">${p.sku} - ${p.product_name} (Tồn: ${p.stock_qty})</option>`).join('')}
      </select>
    </td>
    <td><input type="number" min="1" value="1" class="form-control pur-qty" oninput="calcPurchaseTotals()" required /></td>
    <td><input type="number" min="0" value="${cachedProducts[0]?.import_price || 0}" class="form-control pur-price" oninput="calcPurchaseTotals()" required /></td>
    <td><input type="text" class="form-control pur-serials" placeholder="SN01, SN02..." /></td>
    <td class="text-right pur-line-total">0 ₫</td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calcPurchaseTotals();">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcPurchaseTotals();
}

function filterRowProdSelect(input, selectClass, priceField, onChangeFn) {
  const tr = input.closest('tr');
  const sel = tr.querySelector(selectClass);
  const kw = (input.value || '').trim().toLowerCase();
  const filtered = kw
    ? cachedProducts.filter(
        (p) => (p.sku || '').toLowerCase().includes(kw) || (p.product_name || '').toLowerCase().includes(kw)
      )
    : cachedProducts;
  sel.innerHTML = filtered.length
    ? filtered
        .map(
          (p) =>
            `<option value="${p.product_id}" data-price="${p[priceField]}" data-stock="${p.stock_qty}">${p.sku} - ${p.product_name} (Tồn: ${p.stock_qty})</option>`
        )
        .join('')
    : '<option value="" disabled selected>Không tìm thấy linh kiện</option>';
  if (filtered.length) onChangeFn(sel);
}

function filterPurchaseProdSelect(input) {
  filterRowProdSelect(input, '.pur-prod', 'import_price', onPurchaseProdChange);
}

function filterInvoiceProdSelect(input) {
  filterRowProdSelect(input, '.inv-prod', 'sale_price', onInvoiceProdChange);
}

function onPurchaseProdChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const price = opt ? opt.getAttribute('data-price') || 0 : 0;
  sel.closest('tr').querySelector('.pur-price').value = price;
  calcPurchaseTotals();
}

function calcPurchaseTotals() {
  let grand = 0;
  document.querySelectorAll('#purItemsBody tr').forEach((tr) => {
    const qty = Number(tr.querySelector('.pur-qty').value || 0);
    const price = Number(tr.querySelector('.pur-price').value || 0);
    const line = qty * price;
    grand += line;
    tr.querySelector('.pur-line-total').textContent = formatVND(line);
  });
  document.getElementById('purGrandTotal').textContent = formatVND(grand);
  document.getElementById('purPaid').value = grand;
}

async function submitPurchase(e) {
  e.preventDefault();
  const rows = [...document.querySelectorAll('#purItemsBody tr')];
  if (rows.length === 0) return showToast('Vui lòng thêm ít nhất 1 sản phẩm.', 'error');

  const items = rows.map((tr) => ({
    product_id: Number(tr.querySelector('.pur-prod').value),
    quantity: Number(tr.querySelector('.pur-qty').value),
    import_price: Number(tr.querySelector('.pur-price').value),
    serials: tr.querySelector('.pur-serials').value,
  }));

  try {
    await apiFetch('/api/purchases', {
      method: 'POST',
      body: JSON.stringify({
        supplier_id: Number(document.getElementById('purSupplier').value),
        supplier_invoice_no: document.getElementById('purVatNo').value,
        warehouse_status: document.getElementById('purWhStatus').value,
        payment_method: document.getElementById('purMethod').value,
        paid_amount: Number(document.getElementById('purPaid').value || 0),
        notes: document.getElementById('purNotes').value,
        items,
      }),
    });
    closeModal();
    showToast('Đã lưu phiếu nhập hàng thành công!');
    renderPurchaseTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 7. MODULE BÁN HÀNG (LẬP HÓA ĐƠN + CHẶN VƯỢT TỒN + CÔNG NỢ)
// ============================================================================
async function renderSalesTab(q = '', from = '', to = '', status = '') {
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar" style="flex-wrap:wrap; gap:10px;">
        <div class="search-box" style="flex-wrap:wrap; gap:8px;">
          <input type="text" id="invSearch" class="form-control" style="min-width:220px;" placeholder="Tìm số HĐ, khách hàng, SĐT, nhân viên..." value="${q}" onkeydown="if(event.key==='Enter') applySalesFilter()" />
          <input type="date" id="invFrom" class="form-control" style="width:145px;" title="Từ ngày" value="${from}" />
          <input type="date" id="invTo" class="form-control" style="width:145px;" title="Đến ngày" value="${to}" />
          <select id="invStatus" class="form-control" style="width:170px;" onchange="applySalesFilter()">
            <option value="" ${status === '' ? 'selected' : ''}>Tất cả trạng thái</option>
            <option value="debt" ${status === 'debt' ? 'selected' : ''}>Còn nợ (TK 131)</option>
            <option value="pending" ${status === 'pending' ? 'selected' : ''}>Chờ TT (Online)</option>
            <option value="paid" ${status === 'paid' ? 'selected' : ''}>Đã thanh toán</option>
            <option value="pending_return" ${status === 'pending_return' ? 'selected' : ''}>Chờ đổi trả</option>
            <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Đã hủy & Đổi trả</option>
          </select>
          <button class="btn btn-outline" onclick="applySalesFilter()">Tìm / Lọc</button>
        </div>
        <button class="btn btn-primary" onclick="openCreateInvoiceModal()">+ Lập hóa đơn bán hàng</button>
      </div>

      <div id="salesSummaryCards" class="kpi-grid" style="grid-template-columns:repeat(3,1fr); margin-bottom:16px;">
        <div class="kpi-card"><div class="kpi-label">Tổng doanh thu (gồm VAT)</div><div class="kpi-val" id="sumRev">0 ₫</div></div>
        <div class="kpi-card"><div class="kpi-label">Tổng thực thu</div><div class="kpi-val" style="color:#16a34a;" id="sumPaid">0 ₫</div></div>
        <div class="kpi-card"><div class="kpi-label">Tổng còn phải thu (nợ)</div><div class="kpi-val" style="color:#dc2626;" id="sumDebt">0 ₫</div></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Số HĐ</th>
              <th>Ngày lập</th>
              <th>Khách hàng</th>
              <th>Người lập</th>
              <th>Hình thức TT</th>
              <th class="text-right">Tổng tiền (gồm VAT)</th>
              <th class="text-right">Đã thu</th>
              <th class="text-right">Còn nợ</th>
              <th>Trạng thái</th>
              <th class="text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody id="invBody"><tr><td colspan="10">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status) params.set('status', status);

  const rows = await apiFetch(`/api/invoices?${params.toString()}`);

  const activeRows = rows.filter((i) => !['DaHuy', 'DaDoiTra', 'ChoTraHang'].includes(i.payment_status));
  const totalRev = activeRows.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalPaid = activeRows.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalDebt = activeRows.reduce((s, i) => s + Number(i.debt_amount || 0), 0);
  document.getElementById('sumRev').textContent = formatVND(totalRev);
  document.getElementById('sumPaid').textContent = formatVND(totalPaid);
  document.getElementById('sumDebt').textContent = formatVND(totalDebt);

  document.getElementById('invBody').innerHTML = rows.length
    ? rows
        .map((i) => {
          const isVoid = ['DaHuy', 'DaDoiTra', 'ChoTraHang'].includes(i.payment_status);
          const strike = isVoid ? 'text-decoration:line-through; color:#94a3b8;' : '';
          const canConfirmWh = ['Admin', 'ThuKho'].includes(currentUser.role);
          const canRefundAcc = ['Admin', 'KeToan'].includes(currentUser.role);
          return `
      <tr>
        <td><strong>${i.invoice_no}</strong></td>
        <td>${formatDate(i.invoice_date)}</td>
        <td>${i.customer_name}</td>
        <td>${i.staff_name || '---'}</td>
        <td>${PAYMENT_METHOD_LABELS[i.payment_method] || i.payment_method || '💵 Tiền mặt'}</td>
        <td class="text-right" style="${strike}"><strong>${formatVND(i.total_amount)}</strong></td>
        <td class="text-right" style="${strike}">${formatVND(i.paid_amount)}</td>
        <td class="text-right">${Number(i.debt_amount) > 0 && !isVoid ? `<strong style="color:#dc2626">${formatVND(i.debt_amount)}</strong>` : '0 ₫'}</td>
        <td>${STATUS_BADGES[i.payment_status] || i.payment_status}</td>
        <td class="text-right" style="white-space:nowrap;">
          ${Number(i.debt_amount) > 0 && !isVoid ? `<button class="btn btn-success btn-sm" onclick="openCollectInvoiceModal(${i.invoice_id}, '${i.invoice_no}', ${Number(i.debt_amount)}, '${i.payment_method || 'ChuyenKhoan'}')">💰 Thu tiền</button> ` : ''}
          ${i.payment_status === 'ChoTraHang' && canConfirmWh ? `<button class="btn btn-warning btn-sm" onclick="openConfirmReturnModal(${i.invoice_id})">📦 Kho nhận trả</button> ` : ''}
          ${i.payment_status === 'DaDoiTra' && Number(i.paid_amount) > 0 && !i.has_refund && canRefundAcc ? `<button class="btn btn-danger btn-sm" onclick="openRefundInvoiceModal(${i.invoice_id}, '${i.invoice_no}', ${Number(i.paid_amount)})">💸 Hoàn tiền</button> ` : ''}
          <button class="btn btn-outline btn-sm" onclick="viewInvoiceDetail(${i.invoice_id})">Xem</button>
          <button class="btn btn-outline btn-sm" onclick="printSalesInvoice(${i.invoice_id})">🖨️ In</button>
        </td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="10">Không có hóa đơn phù hợp bộ lọc.</td></tr>';
}

function applySalesFilter() {
  renderSalesTab(
    document.getElementById('invSearch').value,
    document.getElementById('invFrom').value,
    document.getElementById('invTo').value,
    document.getElementById('invStatus').value
  );
}

async function viewInvoiceDetail(id) {
  try {
    const i = await apiFetch(`/api/invoices/${id}`);
    const isVoid = ['DaHuy', 'DaDoiTra', 'ChoTraHang'].includes(i.payment_status);
    openModal(
      `Chi tiết Hóa đơn ${i.invoice_no}`,
      `
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div>
          <p><strong>Khách hàng:</strong> ${i.customer_name} (${i.customer_phone})</p>
          <p><strong>Ngày lập:</strong> ${formatDate(i.invoice_date)} | <strong>Người lập:</strong> ${i.staff_name}</p>
          <p><strong>Thanh toán:</strong> ${PAYMENT_METHOD_LABELS[i.payment_method] || '💵 Tiền mặt'} | ${STATUS_BADGES[i.payment_status] || i.payment_status}</p>
        </div>
      </div>
      ${i.notes ? `<p style="margin-top:6px; color:#475569;"><strong>Ghi chú:</strong> ${i.notes}</p>` : ''}
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th>SKU</th><th>Sản phẩm</th><th>Vị trí kệ</th><th>BH</th><th>Serial / IMEI xuất</th><th class="text-right">SL</th><th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th></tr></thead>
          <tbody>
            ${i.items
              .map(
                (it) => `<tr>
                <td><code>${it.sku}</code></td>
                <td>${it.product_name}</td>
                <td>${it.shelf_location ? `<button type="button" class="btn btn-outline btn-sm" onclick="openWarehouseMapModal('${it.sku}')" title="Định vị trên Sơ đồ kho">🗺️ ${it.shelf_location}</button>` : '<span style="color:#94a3b8;">---</span>'}</td>
                <td>${it.warranty_months || 36}T</td>
                <td>${it.serials && it.serials.length ? it.serials.map((s) => `<code style="display:inline-block;margin:1px 2px;background:#f1f5f9;padding:1px 5px;border-radius:4px;">${s}</code>`).join('') : '<span style="color:#94a3b8;">---</span>'}</td>
                <td class="text-right">${it.quantity}</td>
                <td class="text-right">${formatVND(it.unit_price)}</td>
                <td class="text-right"><strong>${formatVND(it.line_total)}</strong></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="summary-box">
        <div class="summary-row"><span>Tạm tính:</span><span>${formatVND(i.subtotal)}</span></div>
        <div class="summary-row"><span>Thuế VAT:</span><span>${formatVND(i.vat_amount)}</span></div>
        <div class="summary-row total"><span>Tổng thanh toán:</span><span>${formatVND(i.total_amount)}</span></div>
        <div class="summary-row"><span>Khách đã trả:</span><span>${formatVND(i.paid_amount)}</span></div>
        <div class="summary-row"><span>Ghi nợ (TK 131):</span><span style="color:#dc2626; font-weight:700;">${formatVND(i.debt_amount)}</span></div>
      </div>
      ${
        Number(i.debt_amount) > 0 && !isVoid
          ? `<div style="margin:12px 0; padding:10px 14px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
              <img src="https://img.vietqr.io/image/TCB-2122001888888-compact2.png?amount=${Number(i.debt_amount)}&addInfo=${encodeURIComponent(i.invoice_no)}&accountName=${encodeURIComponent('PHAM ANH TUAN')}" alt="VietQR" style="width:120px; height:auto; border-radius:6px; border:1px solid #e2e8f0;" onerror="this.style.display='none'" />
              <div style="font-size:12.5px; line-height:1.6;">
                <div style="font-weight:700; color:#0f172a;">📲 Mã VietQR thanh toán phần còn lại</div>
                <div><strong>Ngân hàng:</strong> Techcombank — <code>2122001888888</code> (PHAM ANH TUAN)</div>
                <div><strong>Số tiền:</strong> <strong style="color:#2563eb;">${formatVND(i.debt_amount)}</strong> | <strong>Nội dung:</strong> <code>${i.invoice_no}</code></div>
              </div>
            </div>`
          : ''
      }
      <div class="modal-footer" style="justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${
            !isVoid
              ? `<button type="button" class="btn btn-outline btn-sm" style="color:#b45309; border-color:#f59e0b;" onclick="changeInvoiceStatus(${i.invoice_id}, 'ChoTraHang')">↩️ Yêu cầu Đổi / Trả hàng</button>
                 <button type="button" class="btn btn-outline btn-sm" onclick="openAssignInvoiceSerialsModal(${i.invoice_id})">🏷️ Gán Serial (S/N)</button>` +
                (Number(i.paid_amount) === 0
                  ? `<button type="button" class="btn btn-danger btn-sm" onclick="changeInvoiceStatus(${i.invoice_id}, 'DaHuy')">✕ Hủy hóa đơn</button>`
                  : '')
              : ''
          }
        </div>
        <div style="display:flex; gap:8px;">
          ${Number(i.debt_amount) > 0 && !isVoid ? `<button type="button" class="btn btn-success" onclick="openCollectInvoiceModal(${i.invoice_id}, '${i.invoice_no}', ${Number(i.debt_amount)}, '${i.payment_method || 'ChuyenKhoan'}')">💰 Xác nhận thu tiền</button>` : ''}
          <button type="button" class="btn btn-outline" onclick="printSalesInvoice(${i.invoice_id})">🖨️ In Hóa Đơn & Phiếu Bảo Hành</button>
          <button type="button" class="btn btn-primary" onclick="closeModal()">Đóng</button>
        </div>
      </div>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openAssignInvoiceSerialsModal(invoiceId) {
  try {
    const [inv, availableSerials] = await Promise.all([
      apiFetch(`/api/invoices/${invoiceId}`),
      apiFetch('/api/invoices/available-serials'),
    ]);
    const grouped = new Map();
    for (const it of inv.items || []) {
      const pid = Number(it.product_id);
      if (!grouped.has(pid)) {
        grouped.set(pid, { ...it, existingSerials: [...(it.serials || [])] });
      } else {
        const g = grouped.get(pid);
        g.quantity += Number(it.quantity);
        g.existingSerials.push(...(it.serials || []));
      }
    }
    const items = [...grouped.values()];
    openModal(
      `🏷️ Gán Serial (S/N) xuất bán — ${inv.invoice_no}`,
      `
      <form onsubmit="submitAssignInvoiceSerials(event, ${invoiceId})">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th class="text-right">SL bán</th>
                <th>Serial đã gán & bổ sung (S/N)</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map((it) => {
                  const uniqueExisting = [...new Set(it.existingSerials)];
                  const availChips = availableSerials
                    .filter((s) => Number(s.product_id) === Number(it.product_id))
                    .slice(0, 6);
                  return `
                <tr>
                  <td><code>${it.sku}</code> — <strong>${it.product_name}</strong></td>
                  <td class="text-right"><strong>${it.quantity}</strong></td>
                  <td>
                    ${uniqueExisting.length ? `<div style="font-size:11px; color:#059669; margin-bottom:4px;">Đã gán (${uniqueExisting.length}/${it.quantity}): ${uniqueExisting.join(', ')}</div>` : ''}
                    <input type="text" class="form-control assign-inv-sn" data-pid="${it.product_id}" placeholder="Nhập S/N cách dấu phẩy (tối đa ${it.quantity})..." value="${uniqueExisting.join(', ')}" />
                    ${
                      availChips.length
                        ? `<div style="margin-top:4px;">${availChips
                            .map(
                              (s) =>
                                `<span class="badge badge-info" style="cursor:pointer; margin:1px; font-size:10px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;" onclick="pickInvoiceSerial(this, '${s.serial_number}', '.assign-inv-sn')">+ ${s.serial_number}</span>`
                            )
                            .join('')}</div>`
                        : ''
                    }
                  </td>
                </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="modal-footer" style="margin-top:14px;">
          <button type="button" class="btn btn-outline" onclick="viewInvoiceDetail(${invoiceId})">← Quay lại HĐ</button>
          <button type="submit" class="btn btn-primary">💾 Lưu Serial hóa đơn</button>
        </div>
      </form>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitAssignInvoiceSerials(e, invoiceId) {
  e.preventDefault();
  const items = [...document.querySelectorAll('.assign-inv-sn')]
    .map((inp) => ({
      product_id: Number(inp.getAttribute('data-pid')),
      serials: inp.value
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    }))
    .filter((it) => it.serials.length > 0);
  if (items.length === 0) {
    return showToast('Vui lòng nhập ít nhất 1 mã Serial.', 'error');
  }
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/serials`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
    showToast(res.message);
    viewInvoiceDetail(invoiceId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openCollectInvoiceModal(invoiceId, invoiceNo, debtAmount, defaultMethod = 'ChuyenKhoan') {
  openModal(
    `Xác nhận thu tiền - ${invoiceNo}`,
    `
    <form onsubmit="submitCollectInvoice(event, ${invoiceId})">
      <div style="background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:14px; border:1px solid #e2e8f0;">
        <div style="display:flex; justify-content:space-between; font-size:14px;">
          <span>Số tiền còn nợ (TK 131):</span>
          <strong style="color:#dc2626;">${formatVND(debtAmount)}</strong>
        </div>
      </div>
      <div class="form-group">
        <label>Số tiền thực thu (VNĐ) *</label>
        <input type="number" id="colInvAmount" class="form-control" min="1000" max="${debtAmount}" value="${debtAmount}" required />
      </div>
      <div class="form-group">
        <label>Hình thức thu tiền *</label>
        <select id="colInvMethod" class="form-control">
          <option value="ChuyenKhoan" ${defaultMethod === 'ChuyenKhoan' ? 'selected' : ''}>Chuyển khoản ngân hàng</option>
          <option value="TienMat" ${defaultMethod === 'TienMat' ? 'selected' : ''}>Tiền mặt (COD / Tại quầy)</option>
          <option value="QuetThe" ${defaultMethod === 'QuetThe' ? 'selected' : ''}>Quẹt thẻ POS</option>
        </select>
      </div>
      <div class="form-group">
        <label>Ghi chú phiếu thu</label>
        <input type="text" id="colInvNotes" class="form-control" value="Xác nhận thu tiền hóa đơn ${invoiceNo}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-success">💰 Xác nhận & Lập Phiếu thu</button>
      </div>
    </form>
    `
  );
}

async function submitCollectInvoice(e, invoiceId) {
  e.preventDefault();
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/collect`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(document.getElementById('colInvAmount').value),
        payment_method: document.getElementById('colInvMethod').value,
        notes: document.getElementById('colInvNotes').value,
      }),
    });
    closeModal();
    showToast(`${res.message} (${res.payment_no})`);
    applySalesFilter();
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function changeInvoiceStatus(id, status) {
  const isReturn = status === 'ChoTraHang';
  const label = isReturn
    ? 'YÊU CẦU ĐỔI / TRẢ HÀNG (sẽ chuyển sang Thủ kho kiểm nhận trước khi cộng kho / hoàn tiền)'
    : 'HỦY hóa đơn (tồn kho sẽ được hoàn lại tự động)';
  const reason = prompt(`Nhập lý do ${label}:`);
  if (reason === null) return;
  try {
    await apiFetch(`/api/invoices/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, reason }),
    });
    closeModal();
    showToast(
      isReturn
        ? 'Đã gửi yêu cầu Trả hàng sang bộ phận Kho kiểm nhận!'
        : 'Đã HỦY hóa đơn và hoàn tồn kho thành công!'
    );
    applySalesFilter();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openConfirmReturnModal(invoiceId, fromInventory = false) {
  try {
    const inv = await apiFetch(`/api/invoices/${invoiceId}`);
    const allSlots = WAREHOUSE_AISLES.flatMap((a) => a.slots);
    openModal(
      `📦 Kho kiểm nhận hàng trả — ${inv.invoice_no}`,
      `
      <div style="background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:13px; border:1px solid #e2e8f0;">
        <div><strong>Khách hàng:</strong> ${inv.customer_name} | <strong>Ngày lập:</strong> ${formatDate(inv.invoice_date)}</div>
        ${inv.notes ? `<div style="color:#475569; margin-top:4px;"><strong>Ghi chú:</strong> ${inv.notes}</div>` : ''}
      </div>
      <form onsubmit="submitConfirmReturn(event, ${invoiceId}, ${fromInventory})">
        <div class="form-group">
          <label>Kết quả kiểm tra hàng hoàn về *</label>
          <select id="retWhCondition" class="form-control" onchange="document.querySelectorAll('.ret-shelf-sel').forEach(s => s.disabled = (this.value === 'defective'))">
            <option value="intact">✅ Hàng còn nguyên vẹn → Nhập lại kho bán & Xếp lên kệ</option>
            <option value="defective">🔴 Hàng bị LỖI / HỎNG → Không cộng tồn bán (Chuyển Bảo hành)</option>
          </select>
        </div>
        <div class="table-wrap" style="margin-bottom:12px;">
          <table>
            <thead><tr><th>SKU</th><th>Sản phẩm</th><th class="text-right">SL trả</th><th>Vị trí kệ xếp lại</th></tr></thead>
            <tbody>
              ${inv.items
                .map(
                  (it) => `
                <tr>
                  <td><code>${it.sku}</code></td>
                  <td><strong>${it.product_name}</strong></td>
                  <td class="text-right"><strong>+${it.quantity}</strong></td>
                  <td>
                    <select class="form-control ret-shelf-sel" data-pid="${it.product_id}">
                      ${allSlots.map((s) => `<option value="${s}" ${s === it.shelf_location ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="form-group">
          <label>Ghi chú kiểm nhận của Thủ kho</label>
          <input type="text" id="retWhNotes" class="form-control" placeholder="VD: Đã kiểm đủ phụ kiện, còn seal / hoặc gãy chân socket..." />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
          <button type="submit" class="btn btn-success">✅ Xác nhận Kho đã nhận hàng</button>
        </div>
      </form>`,
      true
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitConfirmReturn(e, invoiceId, fromInventory = false) {
  e.preventDefault();
  const is_defective = document.getElementById('retWhCondition').value === 'defective';
  const notes = document.getElementById('retWhNotes').value;
  const shelf_assignments = is_defective
    ? []
    : [...document.querySelectorAll('.ret-shelf-sel')].map((sel) => ({
        product_id: Number(sel.getAttribute('data-pid')),
        shelf_location: sel.value,
      }));
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/confirm-return`, {
      method: 'POST',
      body: JSON.stringify({ is_defective, shelf_assignments, notes }),
    });
    closeModal();
    showToast(res.message);
    if (fromInventory) {
      renderInventoryTab(document.getElementById('invtSearch')?.value || '', document.getElementById('invtStatus')?.value || 'all');
    } else if (document.getElementById('invBody')) {
      applySalesFilter();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openRefundInvoiceModal(invoiceId, invoiceNo, paidAmount) {
  openModal(
    `💸 Kế toán lập Phiếu chi hoàn tiền — ${invoiceNo}`,
    `
    <form onsubmit="submitRefundInvoice(event, ${invoiceId})">
      <div style="background:#fef2f2; padding:10px 14px; border-radius:8px; margin-bottom:14px; border:1px solid #fecaca;">
        <div style="display:flex; justify-content:space-between; font-size:14px;">
          <span>Số tiền khách đã thanh toán (tối đa hoàn):</span>
          <strong style="color:#dc2626;">${formatVND(paidAmount)}</strong>
        </div>
      </div>
      <div class="form-group">
        <label>Số tiền hoàn trả khách (VNĐ) *</label>
        <input type="number" id="refInvAmount" class="form-control" min="1000" max="${paidAmount}" value="${paidAmount}" required />
      </div>
      <div class="form-group">
        <label>Hình thức chi hoàn *</label>
        <select id="refInvMethod" class="form-control">
          <option value="ChuyenKhoan">Chuyển khoản ngân hàng</option>
          <option value="TienMat">Tiền mặt tại quỹ</option>
        </select>
      </div>
      <div class="form-group">
        <label>Lý do / Ghi chú phiếu chi</label>
        <input type="text" id="refInvNotes" class="form-control" value="Hoàn tiền trả hàng hóa đơn ${invoiceNo}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-danger">💸 Lập Phiếu chi hoàn tiền</button>
      </div>
    </form>`
  );
}

async function submitRefundInvoice(e, invoiceId) {
  e.preventDefault();
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(document.getElementById('refInvAmount').value),
        payment_method: document.getElementById('refInvMethod').value,
        notes: document.getElementById('refInvNotes').value,
      }),
    });
    closeModal();
    showToast(res.message);
    if (document.getElementById('invBody')) applySalesFilter();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function printSalesInvoice(id) {
  try {
    const i = await apiFetch(`/api/invoices/${id}`);
    const win = window.open('', '_blank', 'width=900,height=740');
    win.document.write(`
      <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Hóa Đơn ${i.invoice_no}</title>
      <style>
        body { font-family: 'Times New Roman', serif; padding: 28px; color: #000; }
        .head { display: flex; justify-content: space-between; margin-bottom: 14px; border-bottom: 2px solid #000; padding-bottom: 10px; }
        h2 { text-align: center; margin: 12px 0 4px; text-transform: uppercase; font-size: 20px; }
        .sub { text-align: center; font-style: italic; margin-bottom: 16px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
        th, td { border: 1px solid #333; padding: 7px 8px; vertical-align: top; }
        th { background: #f1f5f9; }
        .right { text-align: right; }
        .sn-list { font-size: 11px; color: #1e293b; margin-top: 3px; font-family: monospace; }
        .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-top: 30px; font-size: 13px; }
        .warranty-note { margin-top: 14px; font-size: 12px; border: 1px dashed #64748b; padding: 8px 10px; background: #f8fafc; }
      </style></head><body>
      <div class="head">
        <div><strong>CỬA HÀNG LINH KIỆN FAST COMPUTER</strong><br>Showroom: Hà Nội | Hotline: 1900 8889 | MST: 0108889990</div>
        <div style="text-align:right;"><strong>Số HĐ: ${i.invoice_no}</strong><br>Ngày: ${formatDate(i.invoice_date)}</div>
      </div>
      <h2>HÓA ĐƠN BÁN HÀNG & PHIẾU BẢO HÀNH</h2>
      <div class="sub">(Kiêm Phiếu xuất kho — Hình thức thanh toán: ${PAYMENT_METHOD_LABELS[i.payment_method] || 'Tiền mặt'})</div>
      <p><strong>Khách hàng:</strong> ${i.customer_name} — <strong>ĐT:</strong> ${i.customer_phone} ${i.customer_tax_code ? `— <strong>MST:</strong> ${i.customer_tax_code}` : ''}</p>
      <p><strong>Địa chỉ:</strong> ${i.customer_address || '---'} | <strong>Nhân viên bán:</strong> ${i.staff_name}</p>
      <table>
        <thead>
          <tr>
            <th style="width:36px;">STT</th>
            <th>Mã SKU</th>
            <th>Tên linh kiện & Số Serial (S/N)</th>
            <th style="width:55px; text-align:center;">BH</th>
            <th style="width:45px;" class="right">SL</th>
            <th class="right">Đơn giá</th>
            <th class="right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          ${i.items
            .map(
              (it, idx) => `<tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td>${it.sku}</td>
              <td>
                <strong>${it.product_name}</strong>
                ${it.serials && it.serials.length ? `<div class="sn-list">S/N: ${it.serials.join(', ')}</div>` : ''}
              </td>
              <td style="text-align:center;">${it.warranty_months || 36}T</td>
              <td class="right">${it.quantity}</td>
              <td class="right">${formatVND(it.unit_price)}</td>
              <td class="right"><strong>${formatVND(it.line_total)}</strong></td>
            </tr>`
            )
            .join('')}
          <tr><td colspan="6" class="right">Tạm tính:</td><td class="right">${formatVND(i.subtotal)}</td></tr>
          <tr><td colspan="6" class="right">Thuế GTGT (VAT):</td><td class="right">${formatVND(i.vat_amount)}</td></tr>
          <tr><td colspan="6" class="right"><strong>Tổng cộng thanh toán:</strong></td><td class="right"><strong>${formatVND(i.total_amount)}</strong></td></tr>
          <tr><td colspan="6" class="right">Khách đã thanh toán:</td><td class="right">${formatVND(i.paid_amount)}</td></tr>
          <tr><td colspan="6" class="right">Còn nợ (TK 131):</td><td class="right"><strong>${formatVND(i.debt_amount)}</strong></td></tr>
        </tbody>
      </table>
      <div class="warranty-note">
        <strong>Điều kiện bảo hành:</strong> Sản phẩm được bảo hành theo số Serial (S/N) ghi trên phiếu và tem bảo hành nguyên vẹn của FAST Computer. Không bảo hành trường hợp cháy nổ, vào nước, cong chân socket hoặc hư hỏng vật lý.
      </div>
      <div class="sigs">
        <div><strong>Khách hàng</strong><br><em>(Ký, ghi rõ họ tên)</em></div>
        <div><strong>Nhân viên bán hàng</strong><br><em>(Ký, họ tên)</em><br><br><br>${i.staff_name}</div>
        <div><strong>Thủ kho xuất hàng</strong><br><em>(Ký, họ tên)</em></div>
      </div>
      <script>window.onload = () => window.print();</script>
      </body></html>
    `);
    win.document.close();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

let cachedAvailableSerials = [];

async function openCreateInvoiceModal() {
  const [customers, products, serials] = await Promise.all([
    apiFetch('/api/customers'),
    apiFetch('/api/products?lite=1'),
    apiFetch('/api/invoices/available-serials'),
  ]);
  cachedCustomers = customers;
  cachedProducts = products.filter((p) => p.is_active !== false);
  cachedAvailableSerials = serials;

  openModal(
    'Lập Hóa Đơn Bán Hàng Mới',
    `
    <form id="invoiceForm" onsubmit="submitInvoice(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label>Khách hàng *</label>
          <input type="text" id="invCustSearch" class="form-control" style="margin-bottom:5px; font-size:12px; padding:5px 8px;" placeholder="🔍 Tìm tên hoặc SĐT khách hàng..." oninput="filterInvoiceCustSelect(this)" />
          <select id="invCustomer" class="form-control" onchange="onInvoiceCustChange()" required>
            ${customers.map((c) => `<option value="${c.customer_id}">${c.customer_name} (${c.phone})</option>`).join('')}
            <option value="__NEW__">➕ Thêm khách hàng mới...</option>
          </select>
        </div>
        <div class="form-group">
          <label>Thuế VAT (%)</label>
          <select id="invVat" class="form-control" onchange="calcInvoiceTotals()">
            <option value="10" selected>VAT 10%</option>
            <option value="8">VAT 8%</option>
            <option value="0">Không chịu VAT (0%)</option>
          </select>
        </div>
      </div>

      <div id="invNewCustomerBox" style="display:none; background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:10px 12px; margin-bottom:10px;">
        <div style="font-weight:700; font-size:12.5px; color:#1e3a8a; margin-bottom:8px;">➕ Thông tin Khách hàng mới (tự động lưu vào Danh sách Khách hàng)</div>
        <div class="form-grid-2">
          <div class="form-group" style="margin-bottom:6px;">
            <label>Tên khách hàng / Doanh nghiệp *</label>
            <input type="text" id="invNewCustName" class="form-control" placeholder="VD: Anh Minh / Net Cyber..." />
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Nhóm khách hàng *</label>
            <select id="invNewCustGroup" class="form-control">
              <option value="KhachLe">Khách lẻ</option>
              <option value="PhongNet">Phòng Net / Đại lý</option>
              <option value="DoanhNghiep">Doanh nghiệp</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Số điện thoại * (bắt đầu bằng 0)</label>
            <input type="text" id="invNewCustPhone" class="form-control" placeholder="09xxxxxxxx" />
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Email (nhận hóa đơn điện tử)</label>
            <input type="email" id="invNewCustEmail" class="form-control" placeholder="ketoan@congty.vn" />
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Mã số thuế (xuất hóa đơn VAT)</label>
            <input type="text" id="invNewCustTax" class="form-control" placeholder="VD: 0109988776" />
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Hạn mức công nợ tối đa (VNĐ)</label>
            <input type="number" min="0" id="invNewCustLimit" class="form-control" value="10000000" />
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Địa chỉ</label>
          <input type="text" id="invNewCustAddress" class="form-control" placeholder="Địa chỉ (nếu có)" />
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin:10px 0 8px;">
        <strong>Chi tiết hàng bán & Ghi nhận Serial (S/N)</strong>
        <button type="button" class="btn btn-success btn-sm" onclick="addInvoiceRow()">+ Thêm dòng hàng</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sản phẩm (Tồn hiện tại)</th>
              <th style="width:220px;">Serial / IMEI xuất (S/N)</th>
              <th style="width:75px;">SL bán</th>
              <th style="width:130px;">Đơn giá bán</th>
              <th class="text-right" style="width:120px;">Thành tiền</th>
              <th style="width:45px;"></th>
            </tr>
          </thead>
          <tbody id="invItemsBody"></tbody>
        </table>
      </div>

      <div class="summary-box">
        <div class="summary-row"><span>Tạm tính:</span><span id="invSubtotal">0 ₫</span></div>
        <div class="summary-row"><span>Tiền thuế VAT:</span><span id="invVatAmount">0 ₫</span></div>
        <div class="summary-row total"><span>Tổng cộng thanh toán:</span><span id="invGrandTotal">0 ₫</span></div>
        <div class="form-grid-2" style="margin-top:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label>Khách thanh toán ngay (VNĐ) — nhập 0 nếu Ghi nợ</label>
            <input type="number" min="0" id="invPaid" class="form-control" value="0" oninput="updateInvoiceDebtPreview()" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Phương thức thanh toán</label>
            <select id="invMethod" class="form-control" onchange="if(this.value==='CongNo'){document.getElementById('invPaid').value=0;updateInvoiceDebtPreview();} checkInvoiceWalkinRule();">
              <option value="TienMat">💵 Tiền mặt</option>
              <option value="ChuyenKhoan">🏦 Chuyển khoản</option>
              <option value="QuetThe">💳 Quẹt thẻ</option>
              <option value="CongNo">📝 Công nợ (Ghi nợ TK 131)</option>
            </select>
          </div>
        </div>
        <div class="summary-row" style="margin-top:8px;">
          <span>Ghi nhận công nợ còn lại:</span>
          <strong id="invDebtPreview" style="color:#dc2626;">0 ₫</strong>
        </div>
        <div id="invWalkinWarn" style="display:none; margin-top:6px; padding:6px 10px; border-radius:6px; background:#fef2f2; color:#dc2626; font-size:12px; font-weight:600;">
          ⚠️ Khách lẻ tại quầy (#1) bắt buộc thanh toán đủ 100%, không được ghi nợ!
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Lưu Hóa Đơn & Trừ Tồn Kho</button>
      </div>
    </form>`,
    true
  );
  addInvoiceRow();
}

function getSerialChipsHtml(productId) {
  const list = cachedAvailableSerials.filter((s) => Number(s.product_id) === Number(productId));
  if (!list.length) return '<span style="font-size:11px; color:#94a3b8;">Chưa có S/N sẵn trong kho (nhập tay nếu có)</span>';
  const chips = list
    .map(
      (s) =>
        `<button type="button" class="btn btn-outline btn-sm" style="padding:1px 6px; font-size:11px;" onclick="pickInvoiceSerial(this, '${s.serial_number}')">+ ${s.serial_number}</button>`
    )
    .join('');
  return `<div style="max-height:78px; overflow-y:auto; display:flex; flex-wrap:wrap; gap:3px; padding:2px 2px 2px 0;">${chips}</div>`;
}

function pickInvoiceSerial(btn, sn, selector = '.inv-serials') {
  const td = btn.closest('td');
  const input = td.querySelector(selector);
  const current = input.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!current.includes(sn)) {
    current.push(sn);
    input.value = current.join(', ');
  }
}

function addInvoiceRow() {
  const tbody = document.getElementById('invItemsBody');
  const tr = document.createElement('tr');
  const firstProdId = cachedProducts[0]?.product_id || 0;
  tr.innerHTML = `
    <td>
      <input type="text" class="form-control inv-prod-search" style="margin-bottom:5px; font-size:12px; padding:5px 8px;" placeholder="🔍 Gõ SKU / tên để lọc..." oninput="filterInvoiceProdSelect(this)" />
      <select class="form-control inv-prod" onchange="onInvoiceProdChange(this)">
        ${cachedProducts.map((p) => `<option value="${p.product_id}" data-price="${p.sale_price}" data-stock="${p.stock_qty}">${p.sku} - ${p.product_name} (Tồn: ${p.stock_qty})</option>`).join('')}
      </select>
    </td>
    <td>
      <input type="text" class="form-control inv-serials" placeholder="Quét/nhập S/N cách dấu phẩy..." />
      <div class="inv-serial-chips" style="margin-top:3px;">${getSerialChipsHtml(firstProdId)}</div>
    </td>
    <td><input type="number" min="1" value="1" class="form-control inv-qty" oninput="calcInvoiceTotals()" required /></td>
    <td><input type="number" min="0" value="${cachedProducts[0]?.sale_price || 0}" class="form-control inv-price" oninput="calcInvoiceTotals()" required /></td>
    <td class="text-right inv-line-total">0 ₫</td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calcInvoiceTotals();">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcInvoiceTotals();
}

function onInvoiceProdChange(sel) {
  const price = sel.options[sel.selectedIndex].getAttribute('data-price') || 0;
  const tr = sel.closest('tr');
  tr.querySelector('.inv-price').value = price;
  tr.querySelector('.inv-serials').value = '';
  tr.querySelector('.inv-serial-chips').innerHTML = getSerialChipsHtml(sel.value);
  calcInvoiceTotals();
}

let currentInvoiceTotal = 0;

function calcInvoiceTotals() {
  let subtotal = 0;
  document.querySelectorAll('#invItemsBody tr').forEach((tr) => {
    const qty = Number(tr.querySelector('.inv-qty').value || 0);
    const price = Number(tr.querySelector('.inv-price').value || 0);
    const line = qty * price;
    subtotal += line;
    tr.querySelector('.inv-line-total').textContent = formatVND(line);
  });
  const vatRate = Number(document.getElementById('invVat').value || 0);
  const vatAmt = Math.round(subtotal * (vatRate / 100));
  currentInvoiceTotal = subtotal + vatAmt;

  document.getElementById('invSubtotal').textContent = formatVND(subtotal);
  document.getElementById('invVatAmount').textContent = formatVND(vatAmt);
  document.getElementById('invGrandTotal').textContent = formatVND(currentInvoiceTotal);
  document.getElementById('invPaid').value = currentInvoiceTotal;
  updateInvoiceDebtPreview();
}

function updateInvoiceDebtPreview() {
  const paidEl = document.getElementById('invPaid');
  const methodEl = document.getElementById('invMethod');
  const paid = Number(paidEl?.value || 0);
  if (paid > 0 && methodEl && methodEl.value === 'CongNo') {
    methodEl.value = 'TienMat';
  }
  const debt = Math.max(0, currentInvoiceTotal - paid);
  document.getElementById('invDebtPreview').textContent = formatVND(debt);
  checkInvoiceWalkinRule();
}

function filterInvoiceCustSelect(input) {
  const sel = document.getElementById('invCustomer');
  if (!sel) return;
  const kw = (input.value || '').trim().toLowerCase();
  const filtered = kw
    ? cachedCustomers.filter(
        (c) => (c.customer_name || '').toLowerCase().includes(kw) || (c.phone || '').toLowerCase().includes(kw)
      )
    : cachedCustomers;
  sel.innerHTML =
    filtered.map((c) => `<option value="${c.customer_id}">${c.customer_name} (${c.phone})</option>`).join('') +
    '<option value="__NEW__">➕ Thêm khách hàng mới...</option>';
  onInvoiceCustChange();
}

function onInvoiceCustChange() {
  const sel = document.getElementById('invCustomer');
  const box = document.getElementById('invNewCustomerBox');
  if (!sel || !box) return;
  const isNew = sel.value === '__NEW__';
  box.style.display = isNew ? 'block' : 'none';
  const nameEl = document.getElementById('invNewCustName');
  const phoneEl = document.getElementById('invNewCustPhone');
  if (nameEl) nameEl.required = isNew;
  if (phoneEl) phoneEl.required = isNew;
  checkInvoiceWalkinRule();
}

function checkInvoiceWalkinRule() {
  const custEl = document.getElementById('invCustomer');
  const methodEl = document.getElementById('invMethod');
  const paidEl = document.getElementById('invPaid');
  const warnEl = document.getElementById('invWalkinWarn');
  if (!custEl || !methodEl || !paidEl || !warnEl) return;
  const isWalkin = custEl.value !== '__NEW__' && Number(custEl.value) === 1;
  const hasDebt = methodEl.value === 'CongNo' || Math.max(0, currentInvoiceTotal - Number(paidEl.value || 0)) > 0;
  warnEl.style.display = isWalkin && hasDebt ? 'block' : 'none';
}

async function submitInvoice(e) {
  e.preventDefault();
  const rows = [...document.querySelectorAll('#invItemsBody tr')];
  if (rows.length === 0) return showToast('Vui lòng thêm ít nhất 1 dòng hàng.', 'error');

  const rawCustVal = document.getElementById('invCustomer').value;
  let customerId = rawCustVal === '__NEW__' ? 0 : Number(rawCustVal);
  const method = document.getElementById('invMethod').value;
  const paidAmount = Number(document.getElementById('invPaid').value || 0);
  if (rawCustVal !== '__NEW__' && customerId === 1 && (method === 'CongNo' || paidAmount < currentInvoiceTotal)) {
    return showToast('Khách lẻ tại quầy (#1) bắt buộc thanh toán đủ 100%, không được ghi nợ.', 'error');
  }

  const items = rows.map((tr) => ({
    product_id: Number(tr.querySelector('.inv-prod').value),
    quantity: Number(tr.querySelector('.inv-qty').value),
    unit_price: Number(tr.querySelector('.inv-price').value),
    serials: (tr.querySelector('.inv-serials')?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }));

  try {
    if (rawCustVal === '__NEW__') {
      const custName = (document.getElementById('invNewCustName')?.value || '').trim();
      const custPhone = (document.getElementById('invNewCustPhone')?.value || '').trim();
      const custGroup = document.getElementById('invNewCustGroup')?.value || 'KhachLe';
      const custEmail = (document.getElementById('invNewCustEmail')?.value || '').trim();
      const custTax = (document.getElementById('invNewCustTax')?.value || '').trim();
      const rawLimit = document.getElementById('invNewCustLimit')?.value;
      const custLimit = rawLimit !== undefined && rawLimit !== '' ? Number(rawLimit) : 10000000;
      const custAddress = (document.getElementById('invNewCustAddress')?.value || '').trim();
      const createdCust = await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: custName,
          phone: custPhone,
          customer_group: custGroup,
          email: custEmail,
          tax_code: custTax,
          address: custAddress,
          credit_limit: custLimit,
        }),
      });
      customerId = createdCust.customer_id;
    }

    await apiFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        vat_rate: Number(document.getElementById('invVat').value),
        paid_amount: paidAmount,
        payment_method: method,
        items,
      }),
    });
    closeModal();
    showToast('Đã lập hóa đơn và cập nhật tồn kho thành công!');
    renderSalesTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 8. MODULE KHO & TỒN KHO (SƠ ĐỒ KỆ KHO + XEM TỒN + LỊCH SỬ BIẾN ĐỘNG)
// ============================================================================
function makeAisleSlots(aisleCode) {
  const slots = [];
  for (let k = 1; k <= 4; k++) {
    for (let o = 1; o <= 4; o++) {
      slots.push(`Dãy ${aisleCode} - Kệ ${k} - Ô 0${o}`);
    }
  }
  return slots;
}

const WAREHOUSE_AISLES = [
  { name: 'Dãy A · CPU & Tản nhiệt', slots: makeAisleSlots('A') },
  { name: 'Dãy B · VGA, Nguồn & Case', slots: makeAisleSlots('B') },
  { name: 'Dãy C · RAM & Ổ cứng', slots: makeAisleSlots('C') },
  { name: 'Dãy D · Mainboard, Màn hình & Gear', slots: makeAisleSlots('D') },
];

let cachedShelfProducts = [];

async function renderInventoryTab(q = '', status = 'all') {
  const canConfirmWh = ['Admin', 'ThuKho'].includes(currentUser.role);
  const canStocktake = ['Admin', 'KeToan', 'ThuKho'].includes(currentUser.role);
  const canPurchase = ['Admin', 'KeToan', 'ThuKho'].includes(currentUser.role);
  const canMoveShelf = ['Admin', 'ThuKho'].includes(currentUser.role);
  document.getElementById('tab-dynamic').innerHTML = `
    <div id="pendingWhBox"></div>
    <div class="panel" style="margin-bottom:20px;">
      <div class="toolbar" style="flex-wrap:wrap; gap:10px;">
        <div class="search-box">
          <input type="text" id="invtSearch" class="form-control" placeholder="Tìm theo SKU, tên linh kiện, vị trí kệ..." value="${q}" onkeydown="if(event.key==='Enter') renderInventoryTab(this.value, document.getElementById('invtStatus').value)" />
          <select id="invtStatus" class="form-control" style="max-width:170px;" onchange="renderInventoryTab(document.getElementById('invtSearch').value, this.value)">
            <option value="all" ${status === 'all' ? 'selected' : ''}>Tất cả tồn kho</option>
            <option value="low" ${status === 'low' ? 'selected' : ''}>Sắp hết hàng</option>
            <option value="out" ${status === 'out' ? 'selected' : ''}>Đã hết hàng (0)</option>
          </select>
          <button class="btn btn-outline" onclick="renderInventoryTab(document.getElementById('invtSearch').value, document.getElementById('invtStatus').value)">Lọc</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openWarehouseMapModal()">🗺️ Xem Sơ đồ Mặt bằng Kho</button>
          ${canStocktake ? '<button class="btn btn-primary" onclick="openStocktakeModal()">+ Lập phiếu kiểm kho / Cân bằng kho</button>' : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Tên linh kiện</th>
              <th>Loại hàng</th>
              <th>Vị trí kệ</th>
              <th class="text-right">Tồn hiện tại</th>
              <th class="text-right">Tồn tối thiểu</th>
              <th>Tình trạng</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="invtBody"><tr><td colspan="8">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>📜 Thẻ kho — Lịch sử biến động Nhập / Xuất / Kiểm kho</h3></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Loại</th>
              <th>Số chứng từ</th>
              <th>SKU</th>
              <th>Tên linh kiện</th>
              <th class="text-right">Biến động</th>
              <th class="text-right">Tồn sau GD</th>
              <th>Nhân viên</th>
            </tr>
          </thead>
          <tbody id="moveBody"><tr><td colspan="8">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const [allStockForMap, stockRows, moves, allPurchases, pendingReturns] = await Promise.all([
    apiFetch('/api/products?lite=1'),
    apiFetch(`/api/inventory?q=${encodeURIComponent(q)}&status=${status}`),
    apiFetch(`/api/inventory/movements?q=${encodeURIComponent(q)}`),
    canConfirmWh ? apiFetch('/api/purchases').catch(() => []) : Promise.resolve([]),
    canConfirmWh ? apiFetch('/api/invoices/pending-returns').catch(() => []) : Promise.resolve([]),
  ]);
  cachedShelfProducts = allStockForMap;

  const pendingReceipts = (allPurchases || []).filter((r) => r.warehouse_status === 'ChoNhapKho');
  const pendingHtml = [];
  if (canConfirmWh && pendingReceipts.length > 0) {
    pendingHtml.push(`
      <div class="panel" style="margin-bottom:16px; border-left:4px solid #f59e0b; background:#fffbeb;">
        <div class="panel-header" style="margin-bottom:8px;">
          <h3 style="color:#92400e;">📥 Có ${pendingReceipts.length} phiếu nhập đang chờ Thủ kho kiểm đếm & xếp lên kệ</h3>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${pendingReceipts
            .map(
              (r) => `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:#ffffff; padding:8px 12px; border-radius:8px; border:1px solid #fde68a;">
              <div style="font-size:13px;">
                <strong>${r.receipt_no}</strong> · ${r.supplier_name} · <span style="color:#64748b;">${formatDate(r.receipt_date)}</span>
              </div>
              <button class="btn btn-success btn-sm" onclick="confirmWarehouseReceipt(${r.receipt_id}, true)">🔍 Kiểm đếm & Xếp lên kệ</button>
            </div>`
            )
            .join('')}
        </div>
      </div>`);
  }
  if (canConfirmWh && (pendingReturns || []).length > 0) {
    pendingHtml.push(`
      <div class="panel" style="margin-bottom:16px; border-left:4px solid #ea580c; background:#fff7ed;">
        <div class="panel-header" style="margin-bottom:8px;">
          <h3 style="color:#9a3412;">↩️ Có ${pendingReturns.length} đơn Trả hàng đang chờ Thủ kho kiểm nhận</h3>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${pendingReturns
            .map(
              (inv) => `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:#ffffff; padding:8px 12px; border-radius:8px; border:1px solid #fed7aa;">
              <div style="font-size:13px;">
                <strong>${inv.invoice_no}</strong> · ${inv.customer_name} · <span style="color:#64748b;">${formatDate(inv.invoice_date)}</span>
              </div>
              <button class="btn btn-warning btn-sm" onclick="openConfirmReturnModal(${inv.invoice_id}, true)">📦 Kiểm nhận & Xếp lên kệ</button>
            </div>`
            )
            .join('')}
        </div>
      </div>`);
  }
  document.getElementById('pendingWhBox').innerHTML = pendingHtml.join('');

  document.getElementById('invtBody').innerHTML = stockRows.length
    ? stockRows
        .map((p) => {
          let badge = '<span class="badge badge-success">An toàn</span>';
          const isLowOrOut = p.stock_qty <= p.min_stock;
          if (p.stock_qty === 0) badge = '<span class="badge badge-danger">Hết hàng</span>';
          else if (isLowOrOut) badge = '<span class="badge badge-warning">Sắp hết</span>';

          return `
          <tr>
            <td><code>${p.sku}</code></td>
            <td><strong>${p.product_name}</strong></td>
            <td>${p.category_name}</td>
            <td>${p.shelf_location ? `<button type="button" class="btn btn-outline btn-sm" onclick="openWarehouseMapModal('${p.sku}')" title="Định vị trên Sơ đồ kho">🗺️ ${p.shelf_location}</button>` : '-'}</td>
            <td class="text-right"><strong>${p.stock_qty}</strong> ${p.unit}</td>
            <td class="text-right">${p.min_stock}</td>
            <td>${badge}</td>
            <td class="text-right" style="white-space:nowrap;">
              ${isLowOrOut && canPurchase ? `<button class="btn btn-primary btn-sm" onclick="quickPurchaseProduct(${p.product_id})">+ Nhập hàng</button>` : ''}
              ${canStocktake ? `<button class="btn btn-outline btn-sm" onclick="openStocktakeModal(${p.product_id})">Kiểm kho</button>` : ''}
              ${canMoveShelf ? `<button class="btn btn-outline btn-sm" onclick="openMoveShelfModal(${p.product_id}, '${(p.shelf_location || '').replace(/'/g, "\\'")}')">Chuyển kệ</button>` : ''}
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="8">Không có dữ liệu tồn kho phù hợp.</td></tr>';

  document.getElementById('moveBody').innerHTML = moves.length
    ? moves
        .map((m) => {
          let typeBadge = '<span class="badge badge-warning">Xuất bán</span>';
          if (m.move_type === 'NHAP') typeBadge = '<span class="badge badge-success">Nhập kho</span>';
          else if (m.move_type === 'KIEMKHO') typeBadge = '<span class="badge badge-info" style="background:#e0f2fe;color:#0369a1;">Điều chỉnh kiểm kho</span>';

          const deltaStr = m.qty_change > 0 ? `+${m.qty_change}` : `${m.qty_change}`;
          const deltaColor = m.qty_change > 0 ? '#16a34a' : m.qty_change < 0 ? '#dc2626' : '#64748b';
          return `
      <tr>
        <td>${formatDate(m.move_date)}</td>
        <td>${typeBadge}</td>
        <td><strong>${m.doc_no}</strong></td>
        <td><code>${m.sku}</code></td>
        <td>${m.product_name}</td>
        <td class="text-right"><strong style="color:${deltaColor}">${deltaStr}</strong></td>
        <td class="text-right"><strong>${m.balance_after ?? '-'}</strong></td>
        <td>${m.staff_name}</td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="8">Chưa có lịch sử nhập/xuất/kiểm kho.</td></tr>';
}

function renderWarehouseRackCard(aisle, slotMap, qLower) {
  // Nhóm các ô theo từng Kệ (ví dụ: "Kệ 1", "Kệ 2") bên trong Dãy
  const shelvesMap = new Map();
  for (const slotName of aisle.slots) {
    const parts = slotName.split(' - ');
    const shelfTitle = parts[1] ? parts[1].trim() : 'Kệ 1';
    if (!shelvesMap.has(shelfTitle)) shelvesMap.set(shelfTitle, []);
    shelvesMap.get(shelfTitle).push(slotName);
  }

  const shelvesHtml = Array.from(shelvesMap.entries())
    .map(([shelfTitle, slots]) => {
      const binsHtml = slots
        .map((slotName) => {
          const prods = slotMap.get(slotName) || [];
          const parts = slotName.split(' - ');
          const binCode = parts[2] ? parts[2].trim() : slotName;
          const isMatch =
            qLower &&
            prods.some(
              (p) =>
                (p.sku || '').toLowerCase().includes(qLower) ||
                (p.product_name || '').toLowerCase().includes(qLower)
            );
          const hlClass = isMatch ? 'slot-highlight' : '';

          if (prods.length === 0) {
            return `<div class="wh-bin-cell slot-empty ${hlClass}" onclick="openShelfSlotModal('${slotName}')" title="${slotName} (Ô trống — bấm để xếp hàng)">${binCode}</div>`;
          }
          const hasOut = prods.some((p) => p.stock_qty === 0);
          const hasLow = prods.some((p) => p.stock_qty <= p.min_stock);
          const cls = hasOut ? 'slot-out' : hasLow ? 'slot-low' : 'slot-ok';
          const tip = `${slotName}: ` + prods.map((p) => `${p.sku} (${p.stock_qty})`).join(', ');

          return `<div class="wh-bin-cell ${cls} ${hlClass}" onclick="openShelfSlotModal('${slotName}')" title="${tip}">${binCode}</div>`;
        })
        .join('');

      return `
        <div class="wh-shelf-unit">
          <div class="wh-shelf-label">
            <span>🗄️ ${shelfTitle}</span>
          </div>
          <div class="wh-bin-row">${binsHtml}</div>
        </div>`;
    })
    .join('');

  return `
    <div class="wh-rack">
      <div class="aisle-title" style="margin-bottom:0;">${aisle.name}</div>
      <div class="wh-shelves-wrap">${shelvesHtml}</div>
    </div>`;
}

function renderWarehouseFloorplan(highlightQuery = '') {
  const container = document.getElementById('whFloorplanBody');
  if (!container) return;

  const slotMap = new Map();
  for (const p of cachedShelfProducts) {
    if (p.shelf_location) {
      const key = p.shelf_location.trim();
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key).push(p);
    }
  }

  const qLower = (highlightQuery || '').trim().toLowerCase();
  const [aisleA, aisleB, aisleC, aisleD] = WAREHOUSE_AISLES;

  container.innerHTML = `
    <div class="wh-floorplan">
      <div class="wh-zone-bar">
        <div class="wh-gate gate-in">🚚 CỬA NHẬP HÀNG (Từ NCC)</div>
        <div class="wh-gate gate-desk">🔍 Khu Kiểm tra chất lượng & Dán tem Serial</div>
      </div>

      <div class="wh-rack-row">
        ${renderWarehouseRackCard(aisleA, slotMap, qLower)}
        <div class="wh-aisle-lane">Lối đi 1</div>
        ${renderWarehouseRackCard(aisleB, slotMap, qLower)}
      </div>

      <div class="wh-cross-aisle">↔️ HÀNH LANG CHÍNH GIỮA KHO (Xe đẩy / Di chuyển hàng) ↔️</div>

      <div class="wh-rack-row">
        ${renderWarehouseRackCard(aisleC, slotMap, qLower)}
        <div class="wh-aisle-lane">Lối đi 2</div>
        ${renderWarehouseRackCard(aisleD, slotMap, qLower)}
      </div>

      <div class="wh-zone-bar">
        <div class="wh-gate gate-desk">📦 Bàn Đóng gói & Soạn đơn</div>
        <div class="wh-gate gate-desk">🧑‍💻 Quầy Thủ kho / Máy quét mã vạch</div>
        <div class="wh-gate gate-out">🛒 CỬA XUẤT KHO & QUẦY BÁN LẺ</div>
      </div>
    </div>`;
}

async function openWarehouseMapModal(highlightQuery = '') {
  if (!cachedShelfProducts.length) {
    cachedShelfProducts = await apiFetch('/api/products?lite=1');
  }

  openModal(
    '🗺️ Sơ đồ Mặt bằng Nhà kho (2D Floor Plan)',
    `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
      <input type="text" id="whMapSearch" class="form-control" style="max-width:320px;" placeholder="Tìm nhanh SKU / tên linh kiện để phát sáng ô kệ..." value="${highlightQuery}" oninput="renderWarehouseFloorplan(this.value)" />
      <div class="shelf-legend">
        <span><i class="legend-dot" style="background:#16a34a;"></i>Tồn an toàn</span>
        <span><i class="legend-dot" style="background:#d97706;"></i>Sắp hết</span>
        <span><i class="legend-dot" style="background:#dc2626;"></i>Hết hàng</span>
        <span><i class="legend-dot" style="background:#cbd5e1;"></i>Ô trống</span>
      </div>
    </div>
    <div id="whFloorplanBody"></div>
    <div class="modal-footer" style="margin-top:12px;">
      <button type="button" class="btn btn-primary" onclick="closeModal()">Đóng sơ đồ</button>
    </div>`,
    true
  );

  renderWarehouseFloorplan(highlightQuery);
}

function openShelfSlotModal(slotName) {
  const prods = cachedShelfProducts.filter((p) => (p.shelf_location || '').trim() === slotName);
  const canMoveShelf = ['Admin', 'ThuKho'].includes(currentUser.role);
  openModal(
    `Vị trí kệ: ${slotName}`,
    prods.length
      ? `
      <p style="margin-bottom:10px; color:#475569;">Đang có <strong>${prods.length}</strong> mã linh kiện tại ô này:</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>Tên linh kiện</th><th class="text-right">Tồn</th><th class="text-right">Thao tác</th></tr></thead>
          <tbody>
            ${prods
              .map(
                (p) => `<tr>
                <td><code>${p.sku}</code></td>
                <td><strong>${p.product_name}</strong></td>
                <td class="text-right"><strong>${p.stock_qty}</strong> ${p.unit}</td>
                <td class="text-right" style="white-space:nowrap;">
                  <button class="btn btn-outline btn-sm" onclick='viewProductDetail(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Xem</button>
                  ${canMoveShelf ? `<button class="btn btn-primary btn-sm" onclick="openMoveShelfModal(${p.product_id}, '${slotName.replace(/'/g, "\\'")}')">📦 Chuyển kệ</button>` : ''}
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer" style="margin-top:14px;">
        <button type="button" class="btn btn-outline" onclick="openWarehouseMapModal()">← Quay lại Sơ đồ kho</button>
        <button type="button" class="btn btn-primary" onclick="closeModal()">Đóng</button>
      </div>`
      : `
      <p style="color:#64748b;">Ô kệ <strong>${slotName}</strong> hiện đang trống.</p>
      ${
        canMoveShelf
          ? `<div style="margin-top:12px;">
        <label style="display:block; margin-bottom:6px; font-weight:600;">Xếp nhanh một sản phẩm vào ô này:</label>
        <input type="text" id="assignProdSearch" class="form-control" style="margin-bottom:8px;" placeholder="Gõ SKU hoặc tên sản phẩm để lọc nhanh..." oninput="filterAssignProdSelect(this.value)" />
        <div style="display:flex; gap:8px;">
          <select id="assignProdSelect" class="form-control">
            ${cachedShelfProducts.map((p) => `<option value="${p.product_id}">${p.sku} - ${p.product_name} (${p.shelf_location || 'Chưa xếp kệ'})</option>`).join('')}
          </select>
          <button type="button" class="btn btn-primary" style="white-space:nowrap;" onclick="assignProductToSlot('${slotName}')">Xếp vào ô</button>
        </div>
      </div>`
          : `<p style="font-size:12px; color:#94a3b8; margin-top:8px;">Chỉ Thủ kho / Admin mới có quyền xếp hàng vào ô kệ.</p>`
      }
      <div class="modal-footer" style="margin-top:14px;">
        <button type="button" class="btn btn-outline" onclick="openWarehouseMapModal()">← Quay lại Sơ đồ kho</button>
        <button type="button" class="btn btn-primary" onclick="closeModal()">Đóng</button>
      </div>`,
    true
  );
}

function filterAssignProdSelect(q) {
  const select = document.getElementById('assignProdSelect');
  if (!select) return;
  const kw = (q || '').trim().toLowerCase();
  const filtered = kw
    ? cachedShelfProducts.filter(
        (p) =>
          (p.sku || '').toLowerCase().includes(kw) ||
          (p.product_name || '').toLowerCase().includes(kw) ||
          (p.shelf_location || '').toLowerCase().includes(kw)
      )
    : cachedShelfProducts;

  select.innerHTML = filtered.length
    ? filtered
        .map(
          (p) =>
            `<option value="${p.product_id}">${p.sku} - ${p.product_name} (${p.shelf_location || 'Chưa xếp kệ'})</option>`
        )
        .join('')
    : '<option value="" disabled selected>Không tìm thấy sản phẩm phù hợp</option>';
}

async function assignProductToSlot(slotName) {
  const pid = document.getElementById('assignProdSelect').value;
  try {
    await apiFetch('/api/inventory/move-shelf', {
      method: 'PUT',
      body: JSON.stringify({ product_id: Number(pid), shelf_location: slotName }),
    });
    closeModal();
    showToast(`Đã xếp sản phẩm vào ${slotName}!`);
    renderInventoryTab(document.getElementById('invtSearch')?.value || '', document.getElementById('invtStatus')?.value || 'all');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openMoveShelfModal(productId, currentShelf = '') {
  const prod = cachedShelfProducts.find((p) => Number(p.product_id) === Number(productId));
  const allSlots = WAREHOUSE_AISLES.flatMap((a) => a.slots);
  openModal(
    `Chuyển vị trí kệ — ${prod ? prod.sku : ''}`,
    `
    <form onsubmit="submitMoveShelf(event, ${productId})">
      <p style="margin-bottom:12px;"><strong>Sản phẩm:</strong> ${prod ? prod.product_name : ''} (Hiện tại: <code>${currentShelf || 'Chưa có'}</code>)</p>
      <div class="form-group">
        <label>Chọn vị trí kệ mới *</label>
        <select id="newShelfSelect" class="form-control" required>
          ${allSlots.map((s) => `<option value="${s}" ${s === currentShelf ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Xác nhận chuyển kệ</button>
      </div>
    </form>`
  );
}

async function submitMoveShelf(e, productId) {
  e.preventDefault();
  try {
    await apiFetch('/api/inventory/move-shelf', {
      method: 'PUT',
      body: JSON.stringify({ product_id: productId, shelf_location: document.getElementById('newShelfSelect').value }),
    });
    closeModal();
    showToast('Đã chuyển vị trí kệ thành công!');
    renderInventoryTab(document.getElementById('invtSearch')?.value || '', document.getElementById('invtStatus')?.value || 'all');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openStocktakeModal(preselectId = null) {
  const products = cachedShelfProducts.length ? cachedShelfProducts : await apiFetch('/api/products?lite=1');
  cachedShelfProducts = products;
  const firstProd = products.find((p) => Number(p.product_id) === Number(preselectId)) || products[0];

  openModal(
    'Lập Phiếu Kiểm Kho / Cân Bằng Tồn Kho',
    `
    <form onsubmit="submitStocktake(event)">
      <div class="form-group">
        <label>Chọn linh kiện cần kiểm kê *</label>
        <select id="stProd" class="form-control" onchange="onStocktakeProdChange()">
          ${products.map((p) => `<option value="${p.product_id}" data-qty="${p.stock_qty}" ${Number(p.product_id) === Number(firstProd?.product_id) ? 'selected' : ''}>${p.sku} - ${p.product_name} (Phần mềm: ${p.stock_qty})</option>`).join('')}
        </select>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label>Tồn trên phần mềm</label>
          <input type="number" id="stSystemQty" class="form-control" value="${firstProd?.stock_qty ?? 0}" readonly style="background:#f8fafc;" />
        </div>
        <div class="form-group">
          <label>Số lượng thực tế đếm được *</label>
          <input type="number" min="0" id="stActualQty" class="form-control" value="${firstProd?.stock_qty ?? 0}" required />
        </div>
      </div>
      <div class="form-group">
        <label>Lý do điều chỉnh (Hư hỏng, thất thoát, kiểm kê định kỳ...)</label>
        <input type="text" id="stReason" class="form-control" placeholder="VD: Kiểm kê cuối tháng phát hiện thiếu 1 chiếc..." required />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Lưu Phiếu Kiểm Kho</button>
      </div>
    </form>`
  );
}

function onStocktakeProdChange() {
  const sel = document.getElementById('stProd');
  const qty = sel.options[sel.selectedIndex].getAttribute('data-qty') || 0;
  document.getElementById('stSystemQty').value = qty;
  document.getElementById('stActualQty').value = qty;
}

async function submitStocktake(e) {
  e.preventDefault();
  try {
    await apiFetch('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify({
        product_id: Number(document.getElementById('stProd').value),
        actual_qty: Number(document.getElementById('stActualQty').value),
        reason: document.getElementById('stReason').value,
      }),
    });
    closeModal();
    showToast('Đã lập phiếu kiểm kho và cập nhật Thẻ kho!');
    renderInventoryTab(document.getElementById('invtSearch')?.value || '', document.getElementById('invtStatus')?.value || 'all');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function quickPurchaseProduct(productId) {
  const navBtn = document.querySelector('.nav-item[data-tab="purchase"]');
  if (navBtn) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    navBtn.classList.add('active');
  }
  await renderPurchaseTab();
  openCreatePurchaseModal(productId);
}

// ============================================================================
// 9. MODULE KIỂM KÊ KHO (STOCKTAKE)
// ============================================================================
let cachedStockAdjustments = [];

async function renderStocktakeTab(q = '') {
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="search-box">
          <input type="text" id="stSearch" class="form-control" placeholder="Tìm theo số phiếu KK, SKU, tên linh kiện, lý do..." value="${q}" onkeydown="if(event.key==='Enter') renderStocktakeTab(this.value)" />
          <button class="btn btn-outline" onclick="renderStocktakeTab(document.getElementById('stSearch').value)">Tìm</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openWarehouseMapModal()">🗺️ Sơ đồ kho</button>
          <button class="btn btn-primary" onclick="openStocktakeModal().then(() => {})">+ Lập phiếu kiểm kho mới</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Số phiếu KK</th>
              <th>Thời gian kiểm</th>
              <th>SKU</th>
              <th>Tên linh kiện</th>
              <th class="text-right">Tồn phần mềm</th>
              <th class="text-right">Thực tế đếm</th>
              <th class="text-right">Chênh lệch</th>
              <th>Lý do điều chỉnh</th>
              <th>Người kiểm</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="stBody"><tr><td colspan="10">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const rows = await apiFetch(`/api/inventory/adjustments?q=${encodeURIComponent(q)}`);
  cachedStockAdjustments = rows;
  document.getElementById('stBody').innerHTML = rows.length
    ? rows
        .map((r) => {
          const diff = Number(r.diff_qty);
          const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
          const diffColor = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#64748b';
          return `
          <tr>
            <td><strong>${r.adjustment_no}</strong></td>
            <td>${formatDate(r.adjusted_at)}</td>
            <td><code>${r.sku}</code></td>
            <td><strong>${r.product_name}</strong></td>
            <td class="text-right">${r.system_qty} ${r.unit}</td>
            <td class="text-right"><strong>${r.actual_qty}</strong> ${r.unit}</td>
            <td class="text-right"><strong style="color:${diffColor}">${diffStr}</strong></td>
            <td>${r.reason || '---'}</td>
            <td>${r.staff_name}</td>
            <td class="text-right"><button class="btn btn-outline btn-sm" onclick="printStocktakeVoucher(${r.adjustment_id})">🖨️ In</button></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="10">Chưa có phiếu kiểm kê kho nào. Bấm "+ Lập phiếu kiểm kho mới" để cân bằng tồn kho.</td></tr>';
}

function printStocktakeVoucher(id) {
  const r = cachedStockAdjustments.find((x) => Number(x.adjustment_id) === Number(id));
  if (!r) return showToast('Không tìm thấy dữ liệu phiếu kiểm kho.', 'error');
  const diff = Number(r.diff_qty);
  const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
  const win = window.open('', '_blank', 'width=850,height=650');
  win.document.write(`
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Phiếu Kiểm Kho ${r.adjustment_no}</title>
    <style>
      body { font-family: 'Times New Roman', serif; padding: 30px; color: #000; }
      .head { display: flex; justify-content: space-between; margin-bottom: 18px; }
      h2 { text-align: center; margin: 10px 0 4px; text-transform: uppercase; }
      .sub { text-align: center; font-style: italic; margin-bottom: 18px; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
      th, td { border: 1px solid #333; padding: 7px 9px; }
      th { background: #f1f5f9; }
      .right { text-align: right; }
      .center { text-align: center; }
      .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-top: 38px; font-size: 13px; }
    </style></head><body>
    <div class="head">
      <div><strong>CỬA HÀNG LINH KIỆN FAST COMPUTER</strong><br>Showroom: Hà Nội | MST: 0108889990</div>
      <div><strong>Mẫu số 05 - VT</strong><br>Số phiếu: <strong>${r.adjustment_no}</strong></div>
    </div>
    <h2>BIÊN BẢN KIỂM KÊ / PHIẾU ĐIỀU CHỈNH KHO</h2>
    <div class="sub">Thời gian kiểm: ${formatDate(r.adjusted_at)}</div>
    <p><strong>Người thực hiện kiểm kê:</strong> ${r.staff_name}</p>
    <p><strong>Lý do điều chỉnh:</strong> ${r.reason || 'Kiểm kê định kỳ'}</p>
    <table>
      <thead>
        <tr>
          <th class="center">STT</th>
          <th>Mã SKU</th>
          <th>Tên linh kiện</th>
          <th class="center">ĐVT</th>
          <th class="right">Tồn phần mềm</th>
          <th class="right">Thực tế đếm</th>
          <th class="right">Chênh lệch</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">1</td>
          <td>${r.sku}</td>
          <td><strong>${r.product_name}</strong></td>
          <td class="center">${r.unit}</td>
          <td class="right">${r.system_qty}</td>
          <td class="right"><strong>${r.actual_qty}</strong></td>
          <td class="right"><strong>${diffStr}</strong></td>
        </tr>
      </tbody>
    </table>
    <div class="sigs">
      <div><strong>Người kiểm kho (Thủ kho)</strong><br><em>(Ký, họ tên)</em><br><br><br>${r.staff_name}</div>
      <div><strong>Kế toán kho</strong><br><em>(Ký, họ tên)</em></div>
      <div><strong>Giám đốc / Quản lý duyệt</strong><br><em>(Ký, họ tên)</em></div>
    </div>
    <script>window.onload = () => window.print();</script>
    </body></html>
  `);
  win.document.close();
}

// ============================================================================
// 10. MODULE THU - CHI & CÔNG NỢ (FINANCE / CASHBOOK)
// ============================================================================
let cachedFinancePayments = [];

async function renderFinanceTab(q = '', type = '', method = '', from = '', to = '') {
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar" style="flex-wrap:wrap; gap:8px;">
        <div class="search-box" style="flex-wrap:wrap; gap:8px;">
          <input type="text" id="finSearch" class="form-control" style="min-width:200px;" placeholder="Tìm số phiếu PT/PC, ghi chú, người lập..." value="${q}" onkeydown="if(event.key==='Enter') applyFinanceFilter()" />
          <select id="finType" class="form-control" style="width:130px;" onchange="applyFinanceFilter()">
            <option value="" ${type === '' ? 'selected' : ''}>Tất cả Thu/Chi</option>
            <option value="Thu" ${type === 'Thu' ? 'selected' : ''}>Phiếu Thu</option>
            <option value="Chi" ${type === 'Chi' ? 'selected' : ''}>Phiếu Chi</option>
          </select>
          <select id="finMethod" class="form-control" style="width:155px;" onchange="applyFinanceFilter()">
            <option value="" ${method === '' ? 'selected' : ''}>Mọi hình thức</option>
            <option value="TienMat" ${method === 'TienMat' ? 'selected' : ''}>Tiền mặt</option>
            <option value="ChuyenKhoan" ${method === 'ChuyenKhoan' ? 'selected' : ''}>Chuyển khoản</option>
            <option value="QuetThe" ${method === 'QuetThe' ? 'selected' : ''}>Quẹt thẻ</option>
          </select>
          <input type="date" id="finFrom" class="form-control" style="width:140px;" value="${from}" />
          <input type="date" id="finTo" class="form-control" style="width:140px;" value="${to}" />
          <button class="btn btn-outline" onclick="applyFinanceFilter()">Lọc</button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-success" onclick="openPaymentVoucherModal('Thu')">+ Lập Phiếu Thu</button>
          <button class="btn btn-danger" onclick="openPaymentVoucherModal('Chi')">+ Lập Phiếu Chi</button>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px;">
        <div class="kpi-card success"><div class="kpi-label">Tổng Thu trong kỳ</div><div class="kpi-value" id="finTotalThu">0 ₫</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Tổng Chi trong kỳ</div><div class="kpi-value" id="finTotalChi">0 ₫</div></div>
        <div class="kpi-card"><div class="kpi-label">Phải thu khách (TK 131)</div><div class="kpi-value" style="color:#dc2626;" id="finRec">0 ₫</div></div>
        <div class="kpi-card"><div class="kpi-label">Phải trả NCC (TK 331)</div><div class="kpi-value" style="color:#d97706;" id="finPay">0 ₫</div></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Số phiếu</th>
              <th>Thời gian</th>
              <th>Loại</th>
              <th>Hình thức</th>
              <th>Chứng từ liên quan</th>
              <th class="text-right">Số tiền</th>
              <th>Nội dung / Ghi chú</th>
              <th>Người lập</th>
              <th class="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody id="finBody"><tr><td colspan="9">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (method) params.set('method', method);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const data = await apiFetch(`/api/payments?${params.toString()}`);
  const rows = data.payments || [];
  cachedFinancePayments = rows;
  const totalThu = rows.filter((r) => r.payment_type === 'Thu').reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalChi = rows.filter((r) => r.payment_type === 'Chi').reduce((s, r) => s + Number(r.amount || 0), 0);

  document.getElementById('finTotalThu').textContent = formatVND(totalThu);
  document.getElementById('finTotalChi').textContent = formatVND(totalChi);
  document.getElementById('finRec').textContent = formatVND(data.debtSummary?.total_receivable || 0);
  document.getElementById('finPay').textContent = formatVND(data.debtSummary?.total_payable || 0);

  document.getElementById('finBody').innerHTML = rows.length
    ? rows
        .map((r) => {
          let docRef = '<span style="color:#94a3b8;">Thu/Chi ngoài</span>';
          if (r.invoice_no) docRef = `<code>${r.invoice_no}</code>`;
          else if (r.receipt_no) docRef = `<code>${r.receipt_no}</code>`;
          else if (/công nợ|thu nợ/i.test(r.notes || '') && r.payment_type === 'Thu') {
            docRef = '<span class="badge badge-info" style="background:#e0f2fe;color:#0369a1;">Thu nợ TK 131</span>';
          } else if (/trả nợ/i.test(r.notes || '') && r.payment_type === 'Chi') {
            docRef = '<span class="badge badge-warning">Trả nợ TK 331</span>';
          }
          return `
      <tr>
        <td><strong>${r.payment_no}</strong></td>
        <td>${formatDate(r.payment_date)}</td>
        <td>${r.payment_type === 'Thu' ? '<span class="badge badge-success">Phiếu Thu</span>' : '<span class="badge badge-danger">Phiếu Chi</span>'}</td>
        <td>${PAYMENT_METHOD_LABELS[r.payment_method] || r.payment_method}</td>
        <td>${docRef}</td>
        <td class="text-right"><strong style="color:${r.payment_type === 'Thu' ? '#16a34a' : '#dc2626'}">${r.payment_type === 'Thu' ? '+' : '-'}${formatVND(r.amount)}</strong></td>
        <td>${r.notes || '---'}</td>
        <td>${r.staff_name}</td>
        <td class="text-right"><button class="btn btn-outline btn-sm" onclick="printPaymentVoucher(${r.payment_id})">🖨️ In</button></td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="9">Chưa có phát sinh Thu - Chi nào phù hợp.</td></tr>';
}

function printPaymentVoucher(id) {
  const r = cachedFinancePayments.find((x) => Number(x.payment_id) === Number(id));
  if (!r) return showToast('Không tìm thấy dữ liệu phiếu thu/chi.', 'error');
  const isThu = r.payment_type === 'Thu';
  const title = isThu ? 'PHIẾU THU' : 'PHIẾU CHI';
  const formNo = isThu ? 'Mẫu số 01 - TT' : 'Mẫu số 02 - TT';
  const methodText = (PAYMENT_METHOD_LABELS[r.payment_method] || r.payment_method || '').replace(/^[^\w\p{L}]+\s*/u, '');
  const refText = r.invoice_no || r.receipt_no || 'Thu / Chi ngoài hóa đơn';
  const win = window.open('', '_blank', 'width=850,height=650');
  win.document.write(`
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${title} ${r.payment_no}</title>
    <style>
      body { font-family: 'Times New Roman', serif; padding: 30px; color: #000; }
      .head { display: flex; justify-content: space-between; margin-bottom: 18px; }
      h2 { text-align: center; margin: 10px 0 4px; text-transform: uppercase; }
      .sub { text-align: center; font-style: italic; margin-bottom: 18px; font-size: 13px; }
      .box { border: 1px solid #333; padding: 14px 18px; margin: 16px 0; font-size: 14px; line-height: 1.8; }
      .amount { font-size: 18px; font-weight: bold; }
      .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-top: 38px; font-size: 13px; }
    </style></head><body>
    <div class="head">
      <div><strong>CỬA HÀNG LINH KIỆN FAST COMPUTER</strong><br>Showroom: Hà Nội | MST: 0108889990</div>
      <div><strong>${formNo}</strong><br>Số phiếu: <strong>${r.payment_no}</strong></div>
    </div>
    <h2>${title}</h2>
    <div class="sub">Ngày lập: ${formatDate(r.payment_date)}</div>
    <div class="box">
      <div><strong>Hình thức thanh toán:</strong> ${methodText}</div>
      <div><strong>Chứng từ liên quan:</strong> ${refText}</div>
      <div><strong>Lý do ${isThu ? 'thu' : 'chi'}:</strong> ${r.notes || '---'}</div>
      <div><strong>Số tiền:</strong> <span class="amount">${formatVND(r.amount)}</span></div>
    </div>
    <div class="sigs">
      <div><strong>Người lập phiếu</strong><br><em>(Ký, họ tên)</em><br><br><br>${r.staff_name}</div>
      <div><strong>Kế toán / Thủ quỹ</strong><br><em>(Ký, họ tên)</em></div>
      <div><strong>${isThu ? 'Người nộp tiền' : 'Người nhận tiền'}</strong><br><em>(Ký, họ tên)</em></div>
    </div>
    <script>window.onload = () => window.print();</script>
    </body></html>
  `);
  win.document.close();
}

function applyFinanceFilter() {
  renderFinanceTab(
    document.getElementById('finSearch').value,
    document.getElementById('finType').value,
    document.getElementById('finMethod').value,
    document.getElementById('finFrom').value,
    document.getElementById('finTo').value
  );
}

function openPaymentVoucherModal(defaultType = 'Thu') {
  openModal(
    `Lập ${defaultType === 'Thu' ? 'Phiếu Thu' : 'Phiếu Chi'} Quỹ`,
    `
    <form onsubmit="submitPaymentVoucher(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label>Loại phiếu *</label>
          <select id="pvType" class="form-control">
            <option value="Thu" ${defaultType === 'Thu' ? 'selected' : ''}>Phiếu Thu (PT)</option>
            <option value="Chi" ${defaultType === 'Chi' ? 'selected' : ''}>Phiếu Chi (PC)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Hình thức thanh toán *</label>
          <select id="pvMethod" class="form-control">
            <option value="TienMat">💵 Tiền mặt</option>
            <option value="ChuyenKhoan">🏦 Chuyển khoản</option>
            <option value="QuetThe">💳 Quẹt thẻ</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Số tiền (VNĐ) *</label>
        <input type="number" min="1000" id="pvAmount" class="form-control" required />
      </div>
      <div class="form-group">
        <label>Nội dung / Lý do Thu - Chi *</label>
        <input type="text" id="pvNotes" class="form-control" placeholder="VD: Chi tiền điện showroom, Thu phí lắp đặt..." required />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Hủy</button>
        <button type="submit" class="btn btn-primary">Lưu Chứng Từ Quỹ</button>
      </div>
    </form>`
  );
}

async function submitPaymentVoucher(e) {
  e.preventDefault();
  try {
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        payment_type: document.getElementById('pvType').value,
        payment_method: document.getElementById('pvMethod').value,
        amount: Number(document.getElementById('pvAmount').value),
        notes: document.getElementById('pvNotes').value,
      }),
    });
    closeModal();
    showToast('Đã lập phiếu quỹ thành công!');
    applyFinanceFilter();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 11. MODULE BẢO HÀNH LINH KIỆN THEO SERIAL (WARRANTY / RMA)
// ============================================================================
async function renderWarrantyTab(q = '', status = '') {
  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="search-box">
          <input type="text" id="warSearch" class="form-control" style="min-width:260px;" placeholder="Tra cứu Serial (S/N), SKU, Số HĐ, Tên/SĐT khách..." value="${q}" onkeydown="if(event.key==='Enter') applyWarrantyFilter()" />
          <select id="warStatus" class="form-control" style="width:170px;" onchange="applyWarrantyFilter()">
            <option value="" ${status === '' ? 'selected' : ''}>Tất cả trạng thái</option>
            <option value="DaBan" ${status === 'DaBan' ? 'selected' : ''}>Đã bán (Đang BH)</option>
            <option value="BaoHanh" ${status === 'BaoHanh' ? 'selected' : ''}>Đang xử lý BH (RMA)</option>
            <option value="TrongKho" ${status === 'TrongKho' ? 'selected' : ''}>Trong kho</option>
          </select>
          <button class="btn btn-outline" onclick="applyWarrantyFilter()">Tra cứu</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Số Serial (S/N)</th>
              <th>Linh kiện</th>
              <th>Hóa đơn xuất / Khách hàng</th>
              <th>Thời hạn BH</th>
              <th>Trạng thái</th>
              <th class="text-right">Thao tác RMA</th>
            </tr>
          </thead>
          <tbody id="warBody"><tr><td colspan="6">Đang tải...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);

  const rows = await apiFetch(`/api/warranty?${params.toString()}`);
  const WAR_BADGES = {
    TrongKho: '<span class="badge badge-secondary" style="background:#e2e8f0;color:#475569;">Trong kho</span>',
    DaBan: '<span class="badge badge-success">Đã bán (Còn BH)</span>',
    BaoHanh: '<span class="badge badge-warning">Đang bảo hành (RMA)</span>',
  };

  document.getElementById('warBody').innerHTML = rows.length
    ? rows
        .map((w) => {
          const endStr = w.warranty_end ? new Date(w.warranty_end).toLocaleDateString('vi-VN') : '---';
          const isExpired = w.warranty_end && new Date(w.warranty_end) < new Date();
          return `
          <tr>
            <td><code style="font-weight:700; color:#1d4ed8;">${w.serial_number}</code></td>
            <td><code>${w.sku}</code> — <strong>${w.product_name}</strong></td>
            <td>${w.invoice_no ? `<strong>${w.invoice_no}</strong> — ${w.customer_name || ''} (${w.customer_phone || ''})` : '<span style="color:#94a3b8;">Chưa xuất bán</span>'}</td>
            <td>${w.warranty_months || 36}T ${w.invoice_no ? `(Đến ${endStr}${isExpired ? ' · <span style="color:#dc2626;">Hết hạn</span>' : ''})` : ''}</td>
            <td>${WAR_BADGES[w.status] || w.status}</td>
            <td class="text-right" style="white-space:nowrap;">
              ${w.status === 'DaBan' ? `<button class="btn btn-outline btn-sm" style="color:#b45309;border-color:#f59e0b;" onclick="updateWarrantyStatus(${w.serial_id}, 'BaoHanh')">🛠️ Tiếp nhận BH</button>` : ''}
              ${w.status === 'BaoHanh' && w.invoice_no ? `<button class="btn btn-success btn-sm" onclick="updateWarrantyStatus(${w.serial_id}, 'DaBan')">✅ Trả khách sau BH</button>` : ''}
              ${w.status === 'BaoHanh' && !w.invoice_no ? `<button class="btn btn-primary btn-sm" onclick="updateWarrantyStatus(${w.serial_id}, 'TrongKho')">📦 Nhập lại kho sau BH</button>` : ''}
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6">Không tìm thấy mã Serial phù hợp.</td></tr>';
}

function applyWarrantyFilter() {
  renderWarrantyTab(document.getElementById('warSearch').value, document.getElementById('warStatus').value);
}

async function updateWarrantyStatus(serialId, status) {
  try {
    await apiFetch(`/api/warranty/${serialId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    showToast('Đã cập nhật trạng thái bảo hành Serial!');
    applyWarrantyFilter();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 12. MODULE BÁO CÁO THỐNG KÊ (BIỂU ĐỒ TRỰC QUAN + BÁO CÁO KẾ TOÁN)
// ============================================================================
let reportCharts = [];

function buildRingSvg(pct, color = '#2563eb') {
  const safePct = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const r = 24;
  const c = 2 * Math.PI * r;
  const offset = c - (safePct / 100) * c;
  return `
    <div style="position:relative; width:62px; height:62px; flex-shrink:0;">
      <svg width="62" height="62" viewBox="0 0 62 62" style="transform:rotate(-90deg);">
        <circle cx="31" cy="31" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="6" />
        <circle cx="31" cy="31" r="${r}" fill="none" stroke="${color}" stroke-width="6"
                stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" stroke-linecap="round" />
      </svg>
      <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:#1e293b;">${safePct}%</div>
    </div>`;
}

async function renderReportsTab(from = '', to = '') {
  reportCharts.forEach((ch) => ch.destroy());
  reportCharts = [];

  document.getElementById('tab-dynamic').innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="toolbar" style="flex-wrap:wrap; gap:10px;">
        <div class="search-box">
          <strong style="font-size:13px; color:#475569;">📅 Kỳ báo cáo:</strong>
          <input type="date" id="repFrom" class="form-control" style="width:145px;" value="${from}" />
          <span>→</span>
          <input type="date" id="repTo" class="form-control" style="width:145px;" value="${to}" />
          <button class="btn btn-primary" onclick="renderReportsTab(document.getElementById('repFrom').value, document.getElementById('repTo').value)">Xem báo cáo</button>
        </div>
        <button class="btn btn-outline" onclick="window.print()">🖨️ In Báo Cáo</button>
      </div>

      <div id="repRingGrid" class="kpi-grid" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi-card"><div class="kpi-label">Đang tải biểu đồ...</div></div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 2fr 1fr; gap:16px; margin-bottom:16px;">
      <div class="panel">
        <div class="panel-header"><h3>📈 Xu hướng Doanh thu & Thực thu theo ngày</h3></div>
        <div style="height:260px; position:relative;"><canvas id="chartDailyTrend"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><h3>🍩 Tỷ trọng Doanh thu theo Loại hàng</h3></div>
        <div style="height:260px; position:relative;"><canvas id="chartCatRev"></canvas></div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
      <div class="panel">
        <div class="panel-header"><h3>📊 So sánh Doanh thu – Giá vốn – Nhập hàng</h3></div>
        <div style="height:240px; position:relative;"><canvas id="chartCompareBar"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><h3>🔥 Tiến độ bán chạy Top Linh kiện</h3></div>
        <div id="repProgressBars" style="display:flex; flex-direction:column; gap:10px; padding-top:4px;"></div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="panel">
        <div class="panel-header"><h3>🏆 Chi tiết Top 10 Linh kiện bán chạy</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Tên linh kiện</th><th class="text-right">SL bán</th><th class="text-right">Doanh thu</th><th class="text-right">Lợi nhuận gộp</th></tr></thead>
            <tbody id="repTopBody"><tr><td colspan="5">Đang tải...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>📒 Bảng cân đối Công nợ (TK 131 & TK 331)</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Đối tượng</th><th>Loại</th><th>SĐT / MST</th><th class="text-right">Số dư công nợ</th></tr></thead>
            <tbody id="repDebtBody"><tr><td colspan="4">Đang tải...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const data = await apiFetch(`/api/reports?${params.toString()}`);
  const s = data.summary;
  const sub = Number(s.subtotal || 0);
  const rev = Number(s.revenue || 0);
  const collected = Number(s.collected || 0);
  const cogs = Number(s.cogs || 0);
  const profit = Number(s.gross_profit || 0);
  const collectedPct = rev > 0 ? (collected / rev) * 100 : 0;
  const marginPct = sub > 0 ? (profit / sub) * 100 : 0;
  const rec = Number(s.total_receivable || 0);
  const debtRecoveryPct = collected + rec > 0 ? (collected / (collected + rec)) * 100 : 100;
  const safeStockPct = Number(s.total_sku || 0) > 0 ? (Number(s.safe_sku || 0) / Number(s.total_sku)) * 100 : 100;

  document.getElementById('repRingGrid').innerHTML = `
    <div class="kpi-card" style="display:flex; align-items:center; gap:14px;">
      ${buildRingSvg(collectedPct, '#2563eb')}
      <div>
        <div class="kpi-label">Doanh thu (gồm VAT)</div>
        <div class="kpi-value" style="font-size:20px;">${formatVND(rev)}</div>
        <div class="kpi-sub">Đã thu: ${formatVND(collected)}</div>
      </div>
    </div>
    <div class="kpi-card" style="display:flex; align-items:center; gap:14px;">
      ${buildRingSvg(marginPct, '#16a34a')}
      <div>
        <div class="kpi-label">Lợi nhuận gộp</div>
        <div class="kpi-value" style="font-size:20px; color:#16a34a;">${formatVND(profit)}</div>
        <div class="kpi-sub">Giá vốn: ${formatVND(cogs)}</div>
      </div>
    </div>
    <div class="kpi-card" style="display:flex; align-items:center; gap:14px;">
      ${buildRingSvg(debtRecoveryPct, '#0ea5e9')}
      <div>
        <div class="kpi-label">Tỷ lệ thu tiền / Nợ TK 131</div>
        <div class="kpi-value" style="font-size:20px; color:#dc2626;">${formatVND(rec)}</div>
        <div class="kpi-sub">Phải trả TK 331: ${formatVND(s.total_payable)}</div>
      </div>
    </div>
    <div class="kpi-card" style="display:flex; align-items:center; gap:14px;">
      ${buildRingSvg(safeStockPct, '#f59e0b')}
      <div>
        <div class="kpi-label">Giá trị tồn kho (${s.safe_sku}/${s.total_sku} mã an toàn)</div>
        <div class="kpi-value" style="font-size:20px;">${formatVND(s.inventory_value)}</div>
        <div class="kpi-sub">${Number(s.total_units || 0).toLocaleString('vi-VN')} linh kiện</div>
      </div>
    </div>`;

  // 1. Area Line Chart: Xu hướng theo ngày
  if (window.Chart) {
    const ctx1 = document.getElementById('chartDailyTrend').getContext('2d');
    const grad = ctx1.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, 'rgba(37, 99, 235, 0.28)');
    grad.addColorStop(1, 'rgba(37, 99, 235, 0.01)');

    const daily = data.dailyTrend || [];
    reportCharts.push(
      new Chart(ctx1, {
        type: 'line',
        data: {
          labels: daily.length ? daily.map((d) => d.day_label) : ['Chưa có dữ liệu'],
          datasets: [
            {
              label: 'Doanh thu (VNĐ)',
              data: daily.length ? daily.map((d) => Number(d.revenue)) : [0],
              borderColor: '#2563eb',
              backgroundColor: grad,
              fill: true,
              tension: 0.38,
              pointRadius: 5,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#2563eb',
              pointBorderWidth: 2.5,
            },
            {
              label: 'Thực thu (VNĐ)',
              data: daily.length ? daily.map((d) => Number(d.collected)) : [0],
              borderColor: '#16a34a',
              backgroundColor: 'transparent',
              borderDash: [5, 4],
              tension: 0.38,
              pointRadius: 4,
              pointBackgroundColor: '#16a34a',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
            x: { grid: { display: false } },
          },
        },
      })
    );

    // 2. Doughnut Chart: Tỷ trọng doanh thu theo Loại hàng
    const cats = data.categoryRevenue || [];
    reportCharts.push(
      new Chart(document.getElementById('chartCatRev').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: cats.length ? cats.map((c) => c.category_name) : ['Chưa có doanh thu'],
          datasets: [
            {
              data: cats.length ? cats.map((c) => Number(c.revenue)) : [1],
              backgroundColor: ['#2563eb', '#16a34a', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ec4899'],
              borderWidth: 2,
              borderColor: '#fff',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '64%',
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        },
      })
    );

    // 3. Bar Chart: So sánh Doanh thu - Giá vốn - Lợi nhuận - Nhập hàng
    reportCharts.push(
      new Chart(document.getElementById('chartCompareBar').getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['Doanh thu thuần', 'Giá vốn (COGS)', 'Lợi nhuận gộp', 'Tổng nhập hàng'],
          datasets: [
            {
              label: 'Giá trị (VNĐ)',
              data: [sub, cogs, profit, Number(s.purchase_total || 0)],
              backgroundColor: ['#2563eb', '#f59e0b', '#16a34a', '#0ea5e9'],
              borderRadius: 10,
              barPercentage: 0.55,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
            x: { grid: { display: false } },
          },
        },
      })
    );
  }

  // 4. Horizontal Progress Bars: Top linh kiện bán chạy
  const topList = data.topProducts || [];
  const maxQty = Math.max(1, ...topList.map((p) => Number(p.qty_sold || 0)));
  document.getElementById('repProgressBars').innerHTML = topList.length
    ? topList
        .slice(0, 6)
        .map((p) => {
          const pct = Math.round((Number(p.qty_sold) / maxQty) * 100);
          return `
          <div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span><strong>${p.sku}</strong> — ${p.product_name}</span>
              <strong style="color:#2563eb;">${p.qty_sold} cái (${formatVND(p.revenue)})</strong>
            </div>
            <div style="height:9px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:linear-gradient(90deg, #3b82f6, #1d4ed8); border-radius:999px;"></div>
            </div>
          </div>`;
        })
        .join('')
    : '<p style="color:#64748b;">Chưa có dữ liệu bán hàng trong kỳ.</p>';

  document.getElementById('repTopBody').innerHTML = topList.length
    ? topList
        .map(
          (p) => `
      <tr>
        <td><code>${p.sku}</code></td>
        <td><strong>${p.product_name}</strong></td>
        <td class="text-right"><strong>${p.qty_sold}</strong></td>
        <td class="text-right">${formatVND(p.revenue)}</td>
        <td class="text-right" style="color:#16a34a; font-weight:700;">${formatVND(p.profit)}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="5">Chưa có dữ liệu bán hàng trong kỳ.</td></tr>';

  const debtRows = [
    ...data.debtCustomers.map((c) => ({
      name: c.customer_name,
      type: '<span class="badge badge-danger">Phải thu (TK 131)</span>',
      contact: c.phone,
      amount: c.debt_amount,
      color: '#dc2626',
    })),
    ...data.debtSuppliers.map((sup) => ({
      name: sup.supplier_name,
      type: '<span class="badge badge-warning">Phải trả (TK 331)</span>',
      contact: sup.phone,
      amount: sup.payable_balance,
      color: '#d97706',
    })),
  ];

  document.getElementById('repDebtBody').innerHTML = debtRows.length
    ? debtRows
        .map(
          (d) => `
      <tr>
        <td><strong>${d.name}</strong></td>
        <td>${d.type}</td>
        <td>${d.contact}</td>
        <td class="text-right"><strong style="color:${d.color}">${formatVND(d.amount)}</strong></td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4">Không có công nợ tồn đọng.</td></tr>';
}

initApp();

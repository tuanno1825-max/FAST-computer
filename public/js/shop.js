let allProducts = [];
let selectedCategoryId = '';
let selectedBrand = '';
let cart = JSON.parse(localStorage.getItem('fc_cart') || '[]');

function formatVND(v) {
  return Number(v || 0).toLocaleString('vi-VN') + ' ₫';
}

function getCategoryIcon(catName = '') {
  const n = catName.toLowerCase();
  if (n.includes('cpu')) return '🧠';
  if (n.includes('vga') || n.includes('card')) return '🎮';
  if (n.includes('ram')) return '⚡';
  if (n.includes('ssd') || n.includes('ổ cứng')) return '💾';
  if (n.includes('main')) return '🔌';
  return '🖥️';
}

function showShopToast(msg, type = 'success') {
  const t = document.getElementById('shopToast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = 'toast'; }, 3200);
}

function openShopModal(title, html) {
  document.getElementById('shopModalTitle').textContent = title;
  document.getElementById('shopModalBody').innerHTML = html;
  document.getElementById('shopModal').classList.add('open');
}

function closeShopModal() {
  document.getElementById('shopModal').classList.remove('open');
}

function saveCart() {
  localStorage.setItem('fc_cart', JSON.stringify(cart));
  const totalQty = cart.reduce((s, it) => s + it.quantity, 0);
  document.getElementById('cartCount').textContent = totalQty;
}

async function loadCategories() {
  const res = await fetch('/api/shop/categories');
  const cats = await res.json();
  const totalAll = cats.reduce((s, c) => s + c.product_count, 0);

  const list = document.getElementById('categoryFilterList');
  list.innerHTML = `
    <button class="cat-btn ${selectedCategoryId === '' ? 'active' : ''}" onclick="selectCategory('')">
      <span>Tất cả linh kiện</span>
      <span class="cat-count">${totalAll}</span>
    </button>
    ${cats
      .map(
        (c) => `
      <button class="cat-btn ${String(selectedCategoryId) === String(c.category_id) ? 'active' : ''}" onclick="selectCategory('${c.category_id}')">
        <span>${c.category_name}</span>
        <span class="cat-count">${c.product_count}</span>
      </button>`
      )
      .join('')}
  `;
}

function selectCategory(catId) {
  selectedCategoryId = catId;
  loadCategories();
  loadProducts();
}

async function loadBrands() {
  const res = await fetch('/api/shop/brands');
  const brands = await res.json();
  const list = document.getElementById('brandFilterList');
  if (!list) return;
  list.innerHTML = `
    <button class="cat-btn ${selectedBrand === '' ? 'active' : ''}" onclick="selectBrand('')">
      <span>Tất cả thương hiệu</span>
    </button>
    ${brands
      .map(
        (b) => `
      <button class="cat-btn ${selectedBrand === b.brand ? 'active' : ''}" onclick="selectBrand('${b.brand}')">
        <span>${b.brand}</span>
        <span class="cat-count">${b.product_count}</span>
      </button>`
      )
      .join('')}
  `;
}

function selectBrand(brand) {
  selectedBrand = brand;
  loadBrands();
  loadProducts();
}

let shopSearchTimer = null;

function onHeaderSearchInput(val) {
  const clearBtn = document.getElementById('btnClearShopSearch');
  if (clearBtn) clearBtn.style.display = val.trim() ? 'inline-block' : 'none';
  clearTimeout(shopSearchTimer);
  shopSearchTimer = setTimeout(() => loadProducts(), 250);
}

function clearShopSearch() {
  const headerInput = document.getElementById('shopSearch');
  if (headerInput) headerInput.value = '';
  const clearBtn = document.getElementById('btnClearShopSearch');
  if (clearBtn) clearBtn.style.display = 'none';
  loadProducts();
}

async function loadProducts() {
  const q = (document.getElementById('shopSearch')?.value || '').trim();
  const clearBtn = document.getElementById('btnClearShopSearch');
  if (clearBtn) clearBtn.style.display = q ? 'inline-block' : 'none';
  const inStock = document.getElementById('filterInStock').checked;
  const sort = document.getElementById('sortSelect').value;

  const params = new URLSearchParams({ q, sort, in_stock: inStock });
  if (selectedCategoryId) params.set('category_id', selectedCategoryId);
  if (selectedBrand) params.set('brand', selectedBrand);

  const res = await fetch(`/api/shop/products?${params.toString()}`);
  allProducts = await res.json();

  document.getElementById('resultCount').textContent = `Hiển thị ${allProducts.length} linh kiện`;
  const grid = document.getElementById('productGrid');

  if (allProducts.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748b;">Không tìm thấy linh kiện nào phù hợp.</div>';
    return;
  }

  grid.innerHTML = allProducts
    .map((p) => {
      let stockBadge = `<span class="stock-pill stock-ok">Còn ${p.stock_qty} ${p.unit}</span>`;
      if (p.stock_qty === 0) stockBadge = `<span class="stock-pill stock-out">Hết hàng</span>`;
      else if (p.stock_qty <= 5) stockBadge = `<span class="stock-pill stock-low">Còn ${p.stock_qty} ${p.unit}</span>`;

      return `
      <div class="product-card">
        <div class="product-thumb" style="overflow:hidden;">
          ${
            p.image_url
              ? `<img src="${p.image_url}" alt="${p.product_name}" style="width:100%; height:100%; object-fit:contain; padding:6px;" />`
              : `<div class="thumb-emoji">${getCategoryIcon(p.category_name)}</div><span class="thumb-sku">${p.sku}</span>`
          }
        </div>
        <div class="product-cat">${p.brand ? `${p.brand} · ` : ''}${p.category_name}</div>
        <div class="product-title" title="${p.product_name}">${p.product_name}</div>
        <div class="product-meta">
          ${stockBadge}
          <span style="color:#64748b;">BH ${p.warranty_months}T</span>
        </div>
        <div class="product-price">${formatVND(p.sale_price)}</div>
        <div class="product-actions">
          <button class="btn btn-outline btn-sm" onclick="openQuickView(${p.product_id})">Chi tiết</button>
          <button class="btn btn-primary btn-sm" ${p.stock_qty <= 0 ? 'disabled' : ''} onclick="addToCart(${p.product_id})">
            ${p.stock_qty <= 0 ? 'Tạm hết' : '+ Thêm vào giỏ'}
          </button>
        </div>
      </div>`;
    })
    .join('');
}

function openQuickView(productId) {
  const p = allProducts.find((x) => x.product_id === productId);
  if (!p) return;

  openShopModal(
    'Thông số & Bảo hành Linh kiện',
    `
    <div style="display:flex; gap:16px; align-items:center; margin-bottom:16px;">
      ${
        p.image_url
          ? `<img src="${p.image_url}" style="width:88px; height:88px; object-fit:contain; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0; padding:4px;" />`
          : `<div style="width:88px; height:88px; background:#f8fafc; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:40px; border:1px solid #e2e8f0;">${getCategoryIcon(p.category_name)}</div>`
      }
      <div>
        <div style="font-size:12px; color:#2563eb; font-weight:600;">${p.brand ? `${p.brand} · ` : ''}${p.category_name} · SKU: ${p.sku}</div>
        <h3 style="font-size:17px; margin:4px 0;">${p.product_name}</h3>
        <div style="font-size:20px; font-weight:800; color:#2563eb;">${formatVND(p.sale_price)}</div>
      </div>
    </div>
    <table>
      <tr><th>Mã sản phẩm (SKU)</th><td><code>${p.sku}</code></td></tr>
      <tr><th>Hãng sản xuất</th><td><strong>${p.brand || 'Chính hãng'}</strong></td></tr>
      <tr><th>Thông số kỹ thuật</th><td>${p.specs || 'Đang cập nhật'}</td></tr>
      <tr><th>Thời gian bảo hành</th><td><strong>${p.warranty_months} tháng</strong> chính hãng</td></tr>
      <tr><th>Tình trạng kho</th><td>${p.stock_qty > 0 ? `Còn sẵn ${p.stock_qty} ${p.unit} tại showroom` : 'Đang hết hàng'}</td></tr>
    </table>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
      <button class="btn btn-outline" onclick="closeShopModal()">Đóng</button>
      <button class="btn btn-primary" ${p.stock_qty <= 0 ? 'disabled' : ''} onclick="addToCart(${p.product_id}); closeShopModal();">+ Thêm vào giỏ hàng</button>
    </div>`
  );
}

function addToCart(productId) {
  const p = allProducts.find((x) => x.product_id === productId);
  if (!p || p.stock_qty <= 0) return;

  const existing = cart.find((it) => it.product_id === productId);
  if (existing) {
    if (existing.quantity + 1 > p.stock_qty) {
      return showShopToast(`Chỉ còn tối đa ${p.stock_qty} chiếc trong kho!`, 'error');
    }
    existing.quantity += 1;
  } else {
    cart.push({
      product_id: p.product_id,
      sku: p.sku,
      product_name: p.product_name,
      sale_price: Number(p.sale_price),
      max_stock: p.stock_qty,
      quantity: 1,
    });
  }
  saveCart();
  showShopToast(`Đã thêm "${p.product_name}" vào giỏ!`);
}

function updateCartQty(idx, delta) {
  const item = cart[idx];
  const next = item.quantity + delta;
  if (next <= 0) {
    cart.splice(idx, 1);
  } else if (next > item.max_stock) {
    return showShopToast(`Kho chỉ còn ${item.max_stock} chiếc!`, 'error');
  } else {
    item.quantity = next;
  }
  saveCart();
  openCartModal();
}

function openCartModal() {
  if (cart.length === 0) {
    return openShopModal(
      'Giỏ hàng của bạn',
      `<p style="color:#64748b; text-align:center; padding:24px 0;">Giỏ hàng đang trống. Hãy chọn linh kiện bạn muốn mua!</p>`
    );
  }

  const subtotal = cart.reduce((s, it) => s + it.sale_price * it.quantity, 0);
  const vat = Math.round(subtotal * 0.1);
  const total = subtotal + vat;

  openShopModal(
    'Giỏ hàng & Đặt hàng nhanh',
    `
    <table>
      <thead>
        <tr><th>Linh kiện</th><th style="text-align:center;">SL</th><th style="text-align:right;">Thành tiền</th><th></th></tr>
      </thead>
      <tbody>
        ${cart
          .map(
            (it, idx) => `
          <tr>
            <td><strong>${it.product_name}</strong><br><small style="color:#64748b;">${formatVND(it.sale_price)}</small></td>
            <td style="text-align:center; white-space:nowrap;">
              <button class="btn btn-outline btn-sm" onclick="updateCartQty(${idx}, -1)">-</button>
              <strong style="margin:0 6px;">${it.quantity}</strong>
              <button class="btn btn-outline btn-sm" onclick="updateCartQty(${idx}, 1)">+</button>
            </td>
            <td style="text-align:right; white-space:nowrap;"><strong>${formatVND(it.sale_price * it.quantity)}</strong></td>
            <td><button class="btn btn-outline btn-sm" onclick="cart.splice(${idx},1); saveCart(); openCartModal();">✕</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>

    <div class="summary-box">
      <div class="summary-row"><span>Tạm tính:</span><span>${formatVND(subtotal)}</span></div>
      <div class="summary-row"><span>Thuế VAT (10%):</span><span>${formatVND(vat)}</span></div>
      <div class="summary-row total"><span>Tổng thanh toán:</span><span>${formatVND(total)}</span></div>
    </div>

    <form onsubmit="submitOrder(event)">
      <div class="form-group">
        <label>Họ và tên người nhận *</label>
        <input type="text" id="ordName" class="form-control" placeholder="Nguyễn Văn A" required />
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div class="form-group">
          <label>Số điện thoại *</label>
          <input type="text" id="ordPhone" class="form-control" placeholder="09xxxxxxxx" required />
        </div>
        <div class="form-group">
          <label>Hình thức thanh toán</label>
          <select id="ordMethod" class="form-control">
            <option value="ChuyenKhoan">Chuyển khoản ngân hàng</option>
            <option value="TienMat">Thanh toán khi nhận hàng (COD)</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Địa chỉ giao hàng *</label>
        <input type="text" id="ordAddress" class="form-control" placeholder="Số nhà, đường, quận/huyện..." required />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-outline" onclick="closeShopModal()">Tiếp tục mua</button>
        <button type="submit" class="btn btn-primary" id="btnCheckout">Xác nhận Đặt hàng</button>
      </div>
    </form>`
  );
}

async function submitOrder(e) {
  e.preventDefault();
  const btn = document.getElementById('btnCheckout');
  btn.disabled = true;
  btn.textContent = 'Đang xử lý...';

  try {
    const res = await fetch('/api/shop/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: document.getElementById('ordName').value,
        phone: document.getElementById('ordPhone').value,
        address: document.getElementById('ordAddress').value,
        payment_method: document.getElementById('ordMethod').value,
        items: cart.map((it) => ({ product_id: it.product_id, quantity: it.quantity })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Đặt hàng thất bại.');

    cart = [];
    saveCart();
    loadCategories();
    loadProducts();

    const isTransfer = data.payment_method === 'ChuyenKhoan';
    const qrUrl = `https://img.vietqr.io/image/MB-0388888888-compact2.png?amount=${data.total_amount}&addInfo=${encodeURIComponent(data.invoice_no)}&accountName=${encodeURIComponent('FAST COMPUTER')}`;
    const paymentGuideHtml = isTransfer
      ? `<div style="margin:14px auto 0; max-width:360px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:12px; text-align:left; font-size:13px;">
          <div style="font-weight:700; color:#0f172a; margin-bottom:8px; text-align:center;">📲 Thông tin chuyển khoản VietQR</div>
          <div style="text-align:center; margin-bottom:8px;">
            <img src="${qrUrl}" alt="VietQR" style="width:180px; height:auto; border-radius:8px; border:1px solid #e2e8f0;" onerror="this.style.display='none'" />
          </div>
          <div><strong>Ngân hàng:</strong> MB Bank (Quân Đội)</div>
          <div><strong>Số tài khoản:</strong> <code>0388888888</code> — FAST COMPUTER</div>
          <div><strong>Số tiền:</strong> <strong style="color:#2563eb;">${formatVND(data.total_amount)}</strong></div>
          <div><strong>Nội dung CK:</strong> <code style="background:#dbeafe; color:#1d4ed8; padding:2px 6px; border-radius:4px; font-weight:700;">${data.invoice_no}</code></div>
          <div style="color:#b45309; margin-top:8px; font-size:12px;">⏳ Đơn hàng đang ở trạng thái <strong>Chờ xác nhận thanh toán</strong>. Kế toán sẽ đối chiếu và xác nhận ngay khi nhận được tiền.</div>
        </div>`
      : `<p style="font-size:13px; color:#b45309; margin-top:8px;">💵 Đơn hàng <strong>COD (Chờ thu tiền)</strong> đã được ghi nhận. Bạn vui lòng thanh toán <strong>${formatVND(data.total_amount)}</strong> cho nhân viên giao hàng khi nhận hàng.</p>`;

    openShopModal(
      'Đặt hàng thành công!',
      `<div style="text-align:center; padding:12px 0;">
        <div style="font-size:40px; margin-bottom:8px;">✅</div>
        <h3>Cảm ơn bạn đã đặt hàng tại FAST Computer!</h3>
        <p style="margin:8px 0; color:#64748b;">Mã hóa đơn của bạn là: <strong>${data.invoice_no}</strong></p>
        <p style="font-size:18px; font-weight:700; color:#2563eb;">Tổng tiền: ${formatVND(data.total_amount)}</p>
        ${paymentGuideHtml}
        <p style="font-size:12px; color:#64748b; margin-top:10px;">Tồn kho đã được giữ cho đơn hàng của bạn và chuyển về bộ phận Kế toán / Kho.</p>
        <button class="btn btn-primary" style="margin-top:14px;" onclick="closeShopModal()">Đóng</button>
      </div>`
    );
  } catch (err) {
    showShopToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Xác nhận Đặt hàng';
  }
}

document.getElementById('shopSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadProducts();
});

saveCart();
loadCategories();
loadBrands();
loadProducts();

(() => {
  'use strict';

  const state = {
    products: [],
    query: new URLSearchParams(window.location.search).get('q') || '',
    csrfToken: '',
    isAdmin: false,
    adminUser: '',
    editingId: null,
    pendingDeleteId: null,
    logoClicks: 0,
    lastLogoClick: 0,
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {};
  const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

  function ensureAdminUi() {
    if ($('#loginModal')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop hidden" id="loginModal" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <div class="modal-panel">
          <button class="modal-close" id="closeLogin" type="button" aria-label="Tutup login">×</button>
          <p class="modal-kicker">restricted access</p>
          <h2 id="loginTitle">Masuk ke dashboard</h2>
          <p class="modal-lede">Kelola rak produk, tautan afiliasi, dan informasi katalog dari satu tempat.</p>
          <form class="form-stack" id="loginForm">
            <div class="field"><label for="usernameInput">Username</label><input id="usernameInput" name="username" type="text" autocomplete="username" required></div>
            <div class="field"><label for="passwordInput">Password</label><input id="passwordInput" name="password" type="password" autocomplete="current-password" required></div>
            <p class="form-error" id="loginError" role="alert"></p>
            <div class="form-actions"><button class="button button-dark" id="loginButton" type="submit">Login</button></div>
          </form>
        </div>
      </div>

      <section class="admin-dashboard hidden" id="adminDashboard" aria-label="Dashboard Admin">
        <div class="dashboard-shell">
          <header class="dashboard-header">
            <div><p class="dashboard-kicker">ommamarket / control room</p><h2>Dashboard Admin</h2></div>
            <div class="dashboard-header-right"><span class="admin-user" id="adminUserLabel"></span><button class="button button-outline" id="logoutButton" type="button">Logout</button></div>
          </header>
          <div class="dashboard-grid">
            <div class="dashboard-left">
              <section class="admin-panel">
                <div class="admin-panel-heading"><div><h3>Ringkasan</h3><p>Satu angka untuk memantau rak saat ini.</p></div></div>
                <div class="stat-card"><span>Total produk</span><strong id="totalProducts">0</strong></div>
              </section>
              <section class="admin-panel">
                <div class="admin-panel-heading"><div><h3 id="productFormTitle">Tambah produk</h3><p>Isi detail yang akan terlihat di storefront.</p></div></div>
                <form class="admin-form" id="productForm">
                  <div class="form-stack">
                    <div class="field"><label for="productName">Nama produk <span aria-hidden="true">*</span></label><input id="productName" name="name" type="text" maxlength="140" required placeholder="Contoh: Lampu meja minimalis"></div>
                    <div class="field"><label for="productImage">URL gambar produk <span aria-hidden="true">*</span></label><input id="productImage" name="image" type="url" maxlength="2000" required placeholder="https://..."><span class="field-hint">Gunakan URL gambar HTTPS yang bisa diakses publik.</span></div>
                    <div class="field"><label for="productDescription">Deskripsi produk <span aria-hidden="true">*</span></label><textarea id="productDescription" name="description" maxlength="600" required placeholder="Apa yang membuat produk ini layak dipertimbangkan?"></textarea></div>
                    <div class="field"><label for="productPrice">Harga produk <span aria-hidden="true">*</span></label><input id="productPrice" name="price" type="number" min="0" max="999999999" step="1" required placeholder="150000"><span class="field-hint">Masukkan angka tanpa titik atau simbol Rupiah.</span></div>
                    <div class="field"><label for="productShopeeLink">Link Shopee afiliasi <span aria-hidden="true">*</span></label><input id="productShopeeLink" name="shopeeLink" type="url" maxlength="2000" required placeholder="https://shopee.co.id/..."></div>
                  </div>
                  <div class="form-actions"><button class="button button-dark" id="productSubmitButton" type="submit">Tambah produk</button><button class="button button-outline hidden" id="cancelEditButton" type="button">Batal edit</button></div>
                  <p class="form-error" id="productFormError" role="alert"></p>
                </form>
              </section>
            </div>
            <section class="admin-panel">
              <div class="admin-panel-heading"><div><h3>Produk yang tersimpan</h3><p>Edit detail atau hapus produk dari storefront.</p></div></div>
              <div class="admin-product-list" id="adminProductList"></div>
            </section>
          </div>
        </div>
      </section>

      <div class="modal-backdrop hidden" id="confirmModal" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <div class="modal-panel modal-panel-small">
          <p class="modal-kicker">please confirm</p>
          <h2 id="confirmTitle">Hapus produk ini?</h2>
          <p class="modal-lede" id="confirmDescription">Produk akan dihapus dari katalog dan tidak bisa dikembalikan dari dashboard.</p>
          <div class="form-actions"><button class="button button-danger" id="confirmDeleteButton" type="button">Hapus produk</button><button class="button button-outline" id="cancelDeleteButton" type="button">Batal</button></div>
        </div>
      </div>

      <div class="toast-region" id="toastRegion" aria-live="polite" aria-atomic="true"></div>
    `);
  }

  function collectElements() {
    const selectors = {
      brandTrigger: '#brandTrigger',
      searchForm: '#searchForm',
      searchInput: '#searchInput',
      clearSearch: '#clearSearch',
      productGrid: '#productGrid',
      emptyState: '#emptyState',
      emptyTitle: '#emptyTitle',
      emptyDescription: '#emptyDescription',
      emptyClearSearch: '#emptyClearSearch',
      emptyClearButton: '#emptyClearButton',
      resultCount: '#resultCount',
      browseProducts: '#browseProducts',
      loginModal: '#loginModal',
      closeLogin: '#closeLogin',
      loginForm: '#loginForm',
      loginButton: '#loginButton',
      loginError: '#loginError',
      usernameInput: '#usernameInput',
      passwordInput: '#passwordInput',
      adminDashboard: '#adminDashboard',
      adminUserLabel: '#adminUserLabel',
      logoutButton: '#logoutButton',
      totalProducts: '#totalProducts',
      productForm: '#productForm',
      productFormTitle: '#productFormTitle',
      productName: '#productName',
      productImage: '#productImage',
      productDescription: '#productDescription',
      productPrice: '#productPrice',
      productShopeeLink: '#productShopeeLink',
      productSubmitButton: '#productSubmitButton',
      cancelEditButton: '#cancelEditButton',
      productFormError: '#productFormError',
      adminProductList: '#adminProductList',
      confirmModal: '#confirmModal',
      confirmDescription: '#confirmDescription',
      confirmDeleteButton: '#confirmDeleteButton',
      cancelDeleteButton: '#cancelDeleteButton',
      toastRegion: '#toastRegion',
    };

    for (const [key, selector] of Object.entries(selectors)) els[key] = $(selector);
  }

  function showToast(message, type = 'success') {
    if (!els.toastRegion) return;
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' error' : ''}`;
    toast.textContent = message;
    els.toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity .2s ease, transform .2s ease';
      window.setTimeout(() => toast.remove(), 220);
    }, 3400);
  }

  async function apiFetch(url, options = {}) {
    const requestOptions = { ...options, credentials: 'same-origin' };
    const headers = new Headers(options.headers || {});
    const method = (options.method || 'GET').toUpperCase();
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (state.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRF-Token', state.csrfToken);
    requestOptions.headers = headers;

    const response = await fetch(url, requestOptions);
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      if (response.status === 401 && state.isAdmin) handleLoggedOut();
      throw new Error(payload.message || 'Permintaan tidak dapat diproses.');
    }
    return payload;
  }

  function handleLoggedOut() {
    state.isAdmin = false;
    state.csrfToken = '';
    state.adminUser = '';
    closeDashboard();
  }

  function updateCatalogCount() {
    const count = state.products.length;
    document.querySelectorAll('[data-product-count]').forEach((element) => {
      element.textContent = `${count} produk`;
    });
    document.querySelectorAll('[data-catalog-status]').forEach((element) => {
      element.textContent = count > 0 ? 'Rak sedang aktif' : 'Rak sedang disiapkan';
    });
  }

  function setLoading(isLoading) {
    if (!isLoading || !els.productGrid) return;
    els.productGrid.className = 'loading-grid';
    els.productGrid.innerHTML = '';
    for (let i = 0; i < 4; i += 1) {
      const card = document.createElement('div');
      card.className = 'skeleton-card';
      card.innerHTML = '<div class="skeleton-block skeleton-media"></div><div class="skeleton-block skeleton-copy"></div><div class="skeleton-block skeleton-copy short"></div>';
      els.productGrid.appendChild(card);
    }
    els.emptyState?.classList.add('hidden');
    if (els.resultCount) els.resultCount.textContent = 'Memuat produk...';
  }

  function clearLoading() {
    if (els.productGrid) els.productGrid.className = 'product-grid';
  }

  function makeArrowIcon() {
    const wrapper = document.createElement('span');
    wrapper.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h13"></path><path d="m13 6 6 6-6 6"></path></svg>';
    return wrapper.firstElementChild;
  }

  function createProductCard(product, index) {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.style.setProperty('--card-index', index);

    const media = document.createElement('div');
    media.className = 'product-media';
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = product.name;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    const fallback = document.createElement('div');
    fallback.className = 'media-fallback hidden';
    const fallbackText = document.createElement('span');
    fallbackText.textContent = 'Gambar produk tidak tersedia';
    fallback.appendChild(fallbackText);
    image.addEventListener('error', () => {
      image.classList.add('hidden');
      fallback.classList.remove('hidden');
    });
    const label = document.createElement('span');
    label.className = 'product-label';
    label.textContent = 'SHOPEE FIND';
    media.append(image, fallback, label);

    const body = document.createElement('div');
    body.className = 'product-body';
    const meta = document.createElement('div');
    meta.className = 'product-meta';
    const stars = document.createElement('span');
    stars.className = 'stars';
    stars.setAttribute('aria-label', 'Rating 5 dari 5');
    stars.textContent = '★★★★★';
    const rating = document.createElement('span');
    rating.className = 'rating-text';
    rating.textContent = '5.0 / 5';
    meta.append(stars, rating);

    const title = document.createElement('h3');
    title.title = product.name;
    title.textContent = product.name;
    const description = document.createElement('p');
    description.className = 'product-description';
    description.textContent = product.description;

    const footer = document.createElement('div');
    footer.className = 'product-footer';
    const price = document.createElement('strong');
    price.className = 'product-price';
    price.textContent = money.format(product.price);
    const buyLink = document.createElement('a');
    buyLink.className = 'buy-link';
    buyLink.href = product.shopeeLink;
    buyLink.target = '_blank';
    buyLink.rel = 'noopener noreferrer';
    buyLink.append(document.createTextNode('🛒 Beli sekarang '), makeArrowIcon());
    footer.append(price, buyLink);
    body.append(meta, title, description, footer);
    card.append(media, body);
    return card;
  }

  function renderProducts() {
    if (!els.productGrid) return;
    clearLoading();
    const query = state.query.trim().toLocaleLowerCase('id-ID');
    const visibleProducts = state.products.filter((product) => product.name.toLocaleLowerCase('id-ID').includes(query));
    els.productGrid.innerHTML = '';
    els.resultCount.textContent = query ? `${visibleProducts.length} dari ${state.products.length} produk` : `${state.products.length} produk`;
    els.clearSearch?.classList.toggle('hidden', !state.query);
    els.emptyClearSearch?.classList.toggle('hidden', !query || visibleProducts.length > 0);

    if (visibleProducts.length > 0) {
      els.emptyState.classList.add('hidden');
      visibleProducts.forEach((product, index) => els.productGrid.appendChild(createProductCard(product, index)));
      return;
    }

    els.emptyState.classList.remove('hidden');
    if (query) {
      els.emptyTitle.textContent = 'Produk tidak ditemukan';
      els.emptyDescription.textContent = `Belum ada produk yang cocok dengan “${state.query}”. Coba kata pencarian lain atau tampilkan semua produk.`;
      els.emptyClearButton.classList.remove('hidden');
    } else {
      els.emptyTitle.textContent = 'Belum ada produk tersedia';
      els.emptyDescription.textContent = 'Rak ini sedang disiapkan. Produk yang sudah dikurasi akan muncul di sini.';
      els.emptyClearButton.classList.add('hidden');
    }
  }

  async function loadProducts() {
    setLoading(true);
    try {
      const payload = await apiFetch('/api/products');
      state.products = Array.isArray(payload.products) ? payload.products : [];
      updateCatalogCount();
      renderProducts();
      if (state.isAdmin) renderAdminProducts();
    } catch (error) {
      clearLoading();
      if (els.resultCount) els.resultCount.textContent = 'Katalog tidak tersedia';
      if (els.productGrid) els.productGrid.innerHTML = '';
      els.emptyState?.classList.remove('hidden');
      if (els.emptyTitle) els.emptyTitle.textContent = 'Katalog sedang bermasalah';
      if (els.emptyDescription) els.emptyDescription.textContent = error.message;
      showToast(error.message, 'error');
    }
  }

  function openLogin() {
    if (state.isAdmin) {
      openDashboard();
      return;
    }
    els.loginError.textContent = '';
    els.loginModal.classList.remove('hidden');
    document.body.classList.add('is-locked');
    window.setTimeout(() => els.usernameInput.focus(), 40);
  }

  function closeLogin() {
    els.loginModal.classList.add('hidden');
    if (els.adminDashboard.classList.contains('hidden') && els.confirmModal.classList.contains('hidden')) document.body.classList.remove('is-locked');
  }

  function openDashboard() {
    closeLogin();
    els.adminDashboard.classList.remove('hidden');
    document.body.classList.add('is-locked');
    els.adminUserLabel.textContent = state.isAdmin ? `Signed in as ${state.adminUser || 'admin'}` : '';
    renderAdminProducts();
  }

  function closeDashboard() {
    els.adminDashboard.classList.add('hidden');
    if (els.loginModal.classList.contains('hidden') && els.confirmModal.classList.contains('hidden')) document.body.classList.remove('is-locked');
  }

  function resetProductForm() {
    state.editingId = null;
    els.productForm.reset();
    els.productFormTitle.textContent = 'Tambah produk';
    els.productSubmitButton.textContent = 'Tambah produk';
    els.cancelEditButton.classList.add('hidden');
    els.productFormError.textContent = '';
  }

  function startEditing(product) {
    state.editingId = String(product.id);
    els.productName.value = product.name;
    els.productImage.value = product.image;
    els.productDescription.value = product.description;
    els.productPrice.value = product.price;
    els.productShopeeLink.value = product.shopeeLink;
    els.productFormTitle.textContent = 'Edit produk';
    els.productSubmitButton.textContent = 'Update produk';
    els.cancelEditButton.classList.remove('hidden');
    els.productFormError.textContent = '';
    els.productName.focus();
    document.querySelector('.dashboard-left')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function createAdminProductItem(product) {
    const item = document.createElement('article');
    item.className = 'admin-product-item';
    const thumb = document.createElement('div');
    thumb.className = 'admin-product-thumb';
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.src = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 80 80%27%3E%3Crect width=%2780%27 height=%2780%27 fill=%27%23f3eee8%27/%3E%3Cpath d=%27M20 58 34 43l9 9 7-8 10 14%27 fill=%27none%27 stroke=%27%23ee4d2d%27 stroke-width=%273%27/%3E%3C/svg%3E'; });
    thumb.appendChild(image);
    const info = document.createElement('div');
    info.className = 'admin-product-info';
    const name = document.createElement('strong');
    name.textContent = product.name;
    const price = document.createElement('span');
    price.textContent = money.format(product.price);
    const description = document.createElement('small');
    description.textContent = product.description;
    info.append(name, price, description);
    const actions = document.createElement('div');
    actions.className = 'admin-product-actions';
    const edit = document.createElement('button');
    edit.className = 'mini-button';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => startEditing(product));
    const remove = document.createElement('button');
    remove.className = 'mini-button delete';
    remove.type = 'button';
    remove.textContent = 'Hapus';
    remove.addEventListener('click', () => openConfirmDelete(product));
    actions.append(edit, remove);
    item.append(thumb, info, actions);
    return item;
  }

  function renderAdminProducts() {
    if (!els.adminProductList) return;
    els.totalProducts.textContent = state.products.length;
    els.adminProductList.innerHTML = '';
    if (!state.products.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-empty';
      empty.textContent = 'Belum ada produk. Tambahkan produk pertama dari form di sebelah kiri.';
      els.adminProductList.appendChild(empty);
      return;
    }
    state.products.forEach((product) => els.adminProductList.appendChild(createAdminProductItem(product)));
  }

  function openConfirmDelete(product) {
    state.pendingDeleteId = String(product.id);
    els.confirmDescription.textContent = `“${product.name}” akan dihapus dari katalog dan tidak bisa dikembalikan dari dashboard.`;
    els.confirmModal.classList.remove('hidden');
    document.body.classList.add('is-locked');
    els.cancelDeleteButton.focus();
  }

  function closeConfirmDelete() {
    state.pendingDeleteId = null;
    els.confirmModal.classList.add('hidden');
    if (els.loginModal.classList.contains('hidden') && els.adminDashboard.classList.contains('hidden')) document.body.classList.remove('is-locked');
  }

  async function deleteProduct() {
    if (!state.pendingDeleteId) return;
    els.confirmDeleteButton.disabled = true;
    const deletingId = state.pendingDeleteId;
    try {
      await apiFetch(`/api/products/${encodeURIComponent(deletingId)}`, { method: 'DELETE' });
      closeConfirmDelete();
      if (state.editingId === deletingId) resetProductForm();
      await loadProducts();
      showToast('Produk berhasil dihapus.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      els.confirmDeleteButton.disabled = false;
    }
  }

  function getProductPayload() {
    return {
      name: els.productName.value.trim(),
      image: els.productImage.value.trim(),
      description: els.productDescription.value.trim(),
      price: Number(els.productPrice.value),
      shopeeLink: els.productShopeeLink.value.trim(),
    };
  }

  async function submitProduct(event) {
    event.preventDefault();
    els.productFormError.textContent = '';
    els.productSubmitButton.disabled = true;
    try {
      const editing = Boolean(state.editingId);
      await apiFetch(editing ? `/api/products/${encodeURIComponent(state.editingId)}` : '/api/products', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(getProductPayload()),
      });
      resetProductForm();
      await loadProducts();
      showToast(editing ? 'Produk berhasil diupdate.' : 'Produk berhasil ditambahkan.');
    } catch (error) {
      els.productFormError.textContent = error.message;
    } finally {
      els.productSubmitButton.disabled = false;
    }
  }

  async function login(event) {
    event.preventDefault();
    els.loginError.textContent = '';
    els.loginButton.disabled = true;
    try {
      const payload = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: els.usernameInput.value, password: els.passwordInput.value }) });
      state.isAdmin = true;
      state.adminUser = payload.user?.username || els.usernameInput.value;
      state.csrfToken = payload.csrfToken || '';
      els.loginForm.reset();
      closeLogin();
      openDashboard();
      showToast('Login berhasil.');
    } catch (error) {
      els.loginError.textContent = error.message;
    } finally {
      els.loginButton.disabled = false;
    }
  }

  async function logout() {
    els.logoutButton.disabled = true;
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      showToast('Anda sudah logout.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      state.isAdmin = false;
      state.csrfToken = '';
      state.adminUser = '';
      resetProductForm();
      closeDashboard();
      els.logoutButton.disabled = false;
    }
  }

  async function hydrateAuth() {
    try {
      const payload = await apiFetch('/api/auth/me');
      state.isAdmin = Boolean(payload.authenticated);
      state.csrfToken = payload.csrfToken || '';
      state.adminUser = payload.user?.username || '';
    } catch {
      state.isAdmin = false;
    }
  }

  function handleLogoClick(event) {
    const timestamp = Date.now();
    if (timestamp - state.lastLogoClick <= 2000) state.logoClicks += 1;
    else state.logoClicks = 1;
    state.lastLogoClick = timestamp;
    if (state.logoClicks >= 3) {
      event.preventDefault();
      state.logoClicks = 0;
      openLogin();
    }
  }

  function clearSearch() {
    state.query = '';
    if (els.searchInput) els.searchInput.value = '';
    if (els.productGrid) renderProducts();
  }

  function submitSearch() {
    const query = els.searchInput?.value.trim() || '';
    if (els.productGrid) {
      state.query = query;
      renderProducts();
      return;
    }
    window.location.href = query ? `/produk.html?q=${encodeURIComponent(query)}` : '/produk.html';
  }

  function bindEvents() {
    if (els.brandTrigger) els.brandTrigger.addEventListener('click', handleLogoClick);
    if (els.searchForm) els.searchForm.addEventListener('submit', (event) => { event.preventDefault(); submitSearch(); });
    if (els.searchInput) {
      els.searchInput.value = state.query;
      els.searchInput.addEventListener('input', () => {
        if (els.productGrid) {
          state.query = els.searchInput.value;
          renderProducts();
        }
      });
    }
    if (els.clearSearch) els.clearSearch.addEventListener('click', clearSearch);
    if (els.emptyClearSearch) els.emptyClearSearch.addEventListener('click', clearSearch);
    if (els.emptyClearButton) els.emptyClearButton.addEventListener('click', clearSearch);
    if (els.closeLogin) els.closeLogin.addEventListener('click', closeLogin);
    if (els.loginModal) els.loginModal.addEventListener('click', (event) => { if (event.target === els.loginModal) closeLogin(); });
    if (els.loginForm) els.loginForm.addEventListener('submit', login);
    if (els.logoutButton) els.logoutButton.addEventListener('click', logout);
    if (els.productForm) els.productForm.addEventListener('submit', submitProduct);
    if (els.cancelEditButton) els.cancelEditButton.addEventListener('click', resetProductForm);
    if (els.cancelDeleteButton) els.cancelDeleteButton.addEventListener('click', closeConfirmDelete);
    if (els.confirmDeleteButton) els.confirmDeleteButton.addEventListener('click', deleteProduct);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!els.confirmModal.classList.contains('hidden')) closeConfirmDelete();
      else if (!els.loginModal.classList.contains('hidden')) closeLogin();
    });
  }

  async function init() {
    document.querySelectorAll('#currentYear').forEach((element) => { element.textContent = new Date().getFullYear(); });
    ensureAdminUi();
    collectElements();
    bindEvents();
    await hydrateAuth();
    await loadProducts();
  }

  init();
})();

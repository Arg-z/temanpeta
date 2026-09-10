// Komponen UI TemanPeta: DOM murni, tanpa framework.

// Harus sama dengan BIO_MAX di server/src/util.js — dipakai untuk atribut
// maxlength dan penghitung karakter pada panel Profilku.
const BIO_MAX = 160;

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) {
      // Hanya function yang jadi listener — string tidak boleh menyusup
      // menjadi inline event handler (CSP + XSS).
      if (typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Satu-satunya jalur innerHTML yang tersisa: ikon SVG statis dari konstanta
// kode. JANGAN pernah memanggil ini dengan data dari server atau pengguna —
// untuk data apa pun gunakan text/child text node (lihat el()).
export function setIcon(node, svg) {
  node.innerHTML = svg;
}

const jam = (iso) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/* ---------- toast ---------- */

let toastTimer = null;

export function toast(message, isErr = false) {
  const app = document.getElementById('app');
  app.querySelector('.toast')?.remove();
  const node = el('div', { class: `toast pixel-panel${isErr ? ' err' : ''}`, text: message });
  app.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3500);
}/* ---------- modal ---------- */

export function modal({ title, body, textarea, actions }) {
  closeModal();
  const overlay = el('div', { class: 'modal-overlay' });
  const area = textarea
    ? el('textarea', {
        class: 'modal-textarea',
        maxlength: String(textarea.maxLength ?? 500),
        placeholder: textarea.placeholder ?? '',
        rows: '3',
      })
    : null;
  const box = el(
    'div',
    { class: 'modal pixel-panel' },
    el('h3', { text: title }),
    el('p', { text: body }),
    area,
    el(
      'div',
      { class: 'btns' },
      ...actions.map((a) =>
        el('button', {
          class: `btn ${a.kind ?? 'btn-ghost'}`,
          text: a.label,
          onclick: () => {
            closeModal();
            a.onClick?.(area?.value);
          },
        }),
      ),
    ),
  );
  overlay.append(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('app').append(overlay);
  area?.focus();
}

export function closeModal() {
  document.getElementById('app')?.querySelector('.modal-overlay')?.remove();
}

/* ---------- layar masuk / daftar ---------- */

export function renderAuth({ onLogin, onRegister }) {
  const app = document.getElementById('app');
  app.replaceChildren();

  let mode = 'login';
  let busy = false;
  const err = el('p', { class: 'form-error', role: 'alert' });

  // Ikon pixel (SVG rect, bukan emoji) untuk toggle password.
  const ICON_EYE =
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor">' +
    '<rect x="5" y="2" width="6" height="2"/><rect x="3" y="4" width="10" height="2"/>' +
    '<rect x="1" y="6" width="14" height="4"/><rect x="3" y="10" width="10" height="2"/>' +
    '<rect x="5" y="12" width="6" height="2"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="var(--bg-2)"/><rect x="7" y="7" width="2" height="2"/></svg>';
  const ICON_EYE_OFF =
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor">' +
    '<rect x="5" y="2" width="6" height="2"/><rect x="3" y="4" width="10" height="2"/>' +
    '<rect x="1" y="6" width="14" height="4"/><rect x="3" y="10" width="10" height="2"/>' +
    '<rect x="5" y="12" width="6" height="2"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="var(--bg-2)"/>' +
    '<rect x="12" y="1" width="3" height="3"/><rect x="9" y="4" width="3" height="3"/>' +
    '<rect x="6" y="7" width="3" height="3" fill="var(--red)"/><rect x="3" y="10" width="3" height="3" fill="var(--red)"/><rect x="1" y="13" width="3" height="2"/></svg>';

  const fieldLogin = el('input', {
    id: 'f-login',
    autocomplete: 'username',
    maxlength: '24',
    placeholder: 'contoh: budi_01',
    spellcheck: 'false',
    required: 'required',
    'aria-describedby': 'err-f-login',
  });
  const fieldPass = el('input', {
    id: 'f-pass',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'min. 8 karakter',
    required: 'required',
    minlength: '8',
    'aria-describedby': 'err-f-pass',
  });
  const fieldNick = el('input', {
    id: 'f-nick',
    maxlength: '24',
    placeholder: 'nama tampilanmu',
    required: 'required',
    'aria-describedby': 'err-f-nick',
  });

  // Pesan error per field, tepat di bawah input terkait.
  const errLogin = el('p', { class: 'field-error', id: 'err-f-login' });
  const errPass = el('p', { class: 'field-error', id: 'err-f-pass' });
  const errNick = el('p', { class: 'field-error', id: 'err-f-nick' });

  const btnEye = el('button', {
    class: 'eye-btn',
    type: 'button',
    title: 'Tampilkan password',
    'aria-label': 'Tampilkan password',
    'aria-pressed': 'false',
    onclick: () => {
      const show = fieldPass.type === 'password';
      fieldPass.type = show ? 'text' : 'password';
      setIcon(btnEye, show ? ICON_EYE_OFF : ICON_EYE);
      btnEye.title = show ? 'Sembunyikan password' : 'Tampilkan password';
      btnEye.setAttribute('aria-label', btnEye.title);
      btnEye.setAttribute('aria-pressed', String(show));
      fieldPass.focus();
    },
  });
  setIcon(btnEye, ICON_EYE);
  const passWrap = el('div', { class: 'pass-wrap' }, fieldPass, btnEye);

  const rowNick = el(
    'div',
    { class: 'hidden' },
    el('label', { for: 'f-nick', text: 'NICKNAME' }),
    fieldNick,
    errNick,
  );
  const btnSubmit = el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'MASUK' });

  // Pindah mode lewat kalimat pertanyaan — tanpa tab ganda yang redundan.
  const modeBtn = el('button', { class: 'link', type: 'button' });
  const modeLine = el('p', { class: 'mode-line' });

  function setMode(m) {
    mode = m;
    err.textContent = '';
    for (const [f, p] of [
      [fieldLogin, errLogin],
      [fieldPass, errPass],
      [fieldNick, errNick],
    ]) {
      p.textContent = '';
      f.removeAttribute('aria-invalid');
    }
    rowNick.classList.toggle('hidden', m === 'login');
    btnSubmit.textContent = m === 'login' ? 'MASUK' : 'DAFTAR';
    fieldPass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    modeLine.replaceChildren();
    modeLine.append(m === 'login' ? 'Belum punya akun? ' : 'Sudah punya akun? ', modeBtn);
    modeBtn.textContent = m === 'login' ? 'DAFTAR' : 'MASUK';
  }
  modeBtn.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
  setMode('login'); // susun kalimat pertanyaan awal

  const form = el(
    'form',
    { novalidate: 'novalidate' },
    err,
    el('div', {}, el('label', { for: 'f-login', text: 'ID LOGIN (PRIVAT)' }), fieldLogin, errLogin),
    el('div', {}, el('label', { for: 'f-pass', text: 'PASSWORD' }), passWrap, errPass),
    rowNick,
    btnSubmit,
    modeLine,
    el('p', {
      class: 'auth-recover',
      text: 'Lupa password? Pemulihan akun belum tersedia — catat ID login dan password-mu di tempat aman ya.',
    }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    err.textContent = '';
    for (const [f, p] of [
      [fieldLogin, errLogin],
      [fieldPass, errPass],
      [fieldNick, errNick],
    ]) {
      p.textContent = '';
      f.removeAttribute('aria-invalid');
    }

    // Validasi client-side: pesan muncul dekat field-nya, tanpa menyalahkan.
    const loginId = fieldLogin.value.trim();
    const password = fieldPass.value;
    const nickname = fieldNick.value.trim();
    const salah = (field, p, msg) => {
      p.textContent = msg;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    };
    if (!loginId) return salah(fieldLogin, errLogin, 'ID login masih kosong — isi dulu ya.');
    if (!password) return salah(fieldPass, errPass, 'Password masih kosong — isi dulu ya.');
    if (password.length < 8) return salah(fieldPass, errPass, 'Password minimal 8 karakter.');
    if (mode === 'register' && !nickname) return salah(fieldNick, errNick, 'Nickname masih kosong — isi dulu ya.');
    if (mode === 'register' && nickname.length < 2) return salah(fieldNick, errNick, 'Nickname minimal 2 karakter.');

    busy = true;
    const label = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'MEMPROSES...';
    modeBtn.disabled = true;
    try {
      if (mode === 'login') await onLogin(loginId, password);
      else await onRegister(loginId, password, nickname);
    } catch (ex) {
      err.textContent = ex?.message ?? 'Terjadi kesalahan. Coba lagi.';
    } finally {
      busy = false;
      btnSubmit.disabled = false;
      btnSubmit.textContent = label;
      modeBtn.disabled = false;
    }
  });

  app.append(
    el(
      'div',
      { class: 'screen-auth' },
      el(
        'div',
        { class: 'auth-card pixel-panel' },
        el('h1', { class: 'logo' }, 'TEMAN', el('span', {}, 'PETA')),
        el('p', { class: 'tagline', text: 'Temukan teman baru dari peta Indonesia.' }),
        el(
          'div',
          { class: 'auth-steps' },
          el('div', { class: 'step' }, el('span', { class: 'n', text: '1' }), el('span', { text: 'Daftar — kamu dapat ID publik 8 karakter' })),
          el('div', { class: 'step' }, el('span', { class: 'n', text: '2' }), el('span', { text: 'Cari wilayah atau ID publik teman di peta' })),
          el('div', { class: 'step' }, el('span', { class: 'n', text: '3' }), el('span', { text: 'Kirim permintaan teman, lalu ngobrol' })),
        ),
        form,
        el(
          'details',
          { class: 'auth-info' },
          el('summary', { text: 'Apa bedanya ID login, nickname, dan ID publik?' }),
          el(
            'div',
            { class: 'auth-info-body' },
            el('p', {}, el('b', { text: 'ID login' }), ' — kunci masuk akunmu, privat, tidak pernah tampil ke orang lain.'),
            el('p', {}, el('b', { text: 'Nickname' }), ' — nama tampilanmu yang terlihat pengguna lain.'),
            el('p', {}, el('b', { text: 'ID publik' }), ' — kode 8 karakter untuk dicari; kamu yang memilih membagikannya ke siapa.'),
          ),
        ),
        el('p', {
          class: 'auth-hint',
          text: 'ID login hanya kamu yang tahu — orang lain mencarimu lewat ID publik.',
        }),
      ),
      el(
        'div',
        { class: 'auth-foot' },
        el('div', { class: 'brand-domain', text: 'TEMANPETA • CONNEXT.WEB.ID' }),
        el(
          'div',
          { class: 'foot-links' },
          el('button', {
            class: 'foot-link',
            text: 'Kebijakan Privasi',
            onclick: () =>
              modal({
                title: 'KEBIJAKAN PRIVASI',
                body: 'Kami tidak menyimpan koordinat presisi — hanya wilayah perkiraan (kabupaten/kota). ID login selalu privat; ID publik bisa kamu bagikan untuk dicari. Laporan pengguna hanya dibaca admin.',
                actions: [{ label: 'TUTUP', kind: 'btn-ghost' }],
              }),
          }),
          el('button', {
            class: 'foot-link',
            text: 'Syarat Penggunaan',
            onclick: () =>
              modal({
                title: 'SYARAT PENGGUNAAN',
                body: 'Gunakan TemanPeta dengan ramah dan sopan. Pelecehan, spam, atau peniruan identitas dapat diblokir admin tanpa pemberitahuan.',
                actions: [{ label: 'TUTUP', kind: 'btn-ghost' }],
              }),
          }),
        ),
      ),
    ),
  );
}

/* ---------- onboarding pengguna baru ---------- */

export function renderOnboarding(host, { onSearch, onClose }) {
  host.querySelector('.onboard')?.remove();
  const card = el(
    'div',
    { class: 'onboard pixel-panel', role: 'dialog', 'aria-label': 'Panduan mulai mencari teman' },
    el('h2', { text: 'MULAI CARI TEMAN' }),
    el('p', { text: 'Cari kota, nickname, atau ID publik untuk menemukan teman.' }),
    el(
      'ol',
      { class: 'onboard-steps' },
      el('li', { text: 'Cari wilayah — lihat siapa saja yang ada di sana' }),
      el('li', { text: 'Buka profilnya' }),
      el('li', { text: 'Kirim permintaan teman, lalu mulai chat' }),
    ),
    el(
      'div',
      { class: 'btns' },
      el('button', { class: 'btn btn-block', text: 'CARI KOTA', onclick: onSearch }),
      el('button', { class: 'btn btn-ghost', text: 'NANTI SAJA', onclick: onClose }),
    ),
  );
  host.append(card);
}

export function removeOnboarding(host) {
  host?.querySelector('.onboard')?.remove();
}

/* ---------- halaman admin ---------- */

export function renderAdmin({ me, onLogout, onOpenMap, onRefreshLogins }) {
  const app = document.getElementById('app');
  app.replaceChildren();

  const input = el('input', {
    placeholder: 'Cari nickname, ID login, atau ID publik...',
    autocomplete: 'off',
    'aria-label': 'Cari pengguna',
  });
  const userList = el('div', { class: 'admin-list' });
  const reportList = el('div', { class: 'admin-list' });
  const loginList = el('div', { class: 'admin-list' });
  const loginsBtn = el('button', {
    class: 'btn btn-ghost',
    text: 'PERBARUI LOG',
    onclick: onRefreshLogins,
  });

  app.append(
    el(
      'div',
      { class: 'screen-admin' },
      el(
        'div',
        { class: 'admin-card pixel-panel' },
        el(
          'div',
          { class: 'admin-head' },
          el('h1', { class: 'logo' }, 'TEMAN', el('span', {}, 'PETA')),
          el(
            'div',
            { class: 'btns' },
            el('button', { class: 'btn btn-ghost', text: 'BUKA PETA', onclick: onOpenMap }),
            el('button', { class: 'btn btn-ghost', text: 'KELUAR', onclick: onLogout }),
          ),
        ),
        el('p', { class: 'adm-sub', text: `MODE ADMIN — masuk sebagai ${me.nickname} (${me.publicId})` }),
        el('h2', { class: 'adm-title', text: 'PENGGUNA' }),
        input,
        userList,
        el('h2', { class: 'adm-title', text: 'LAPORAN MASUK' }),
        reportList,
        el('h2', { class: 'adm-title', text: 'LOG MASUK — PERANGKAT & LOKASI IP' }),
        loginsBtn,
        loginList,
      ),
    ),
  );
  return { input, userList, reportList, loginList, loginsBtn };
}

export function adminUserRow(u, { onBan }) {
  return el(
    'div',
    { class: 'user-card' },
    el(
      'div',
      { class: 'who' },
      el(
        'div',
        { class: 'n' },
        u.nickname,
        u.banned ? el('span', { class: 'badge badge-msg', text: 'DIBAN' }) : null,
      ),
      el('div', { class: 'id', text: `${u.login_id} • ${u.public_id}` }),
      el('div', {
        class: 'r',
        text: `${u.region_code ?? 'tanpa wilayah'} • sesi aktif: ${u.sesi_aktif ? 'ya' : 'tidak'} • daftar ${new Date(u.created_at).toLocaleDateString('id-ID')}`,
      }),
    ),
    el(
      'div',
      { class: 'actions' },
      el('button', {
        class: `btn ${u.banned ? 'btn-ghost' : 'btn-danger'}`,
        text: u.banned ? 'UNBAN' : 'BAN',
        onclick: () => onBan(u),
      }),
    ),
  );
}

export function adminReportRow(r) {
  return el(
    'div',
    { class: 'user-card' },
    el(
      'div',
      { class: 'who' },
      el('div', { class: 'n', text: `${r.pelapor} melaporkan ${r.dilaporkan}` }),
      el('div', { class: 'r', text: `${r.pelapor_id} • ${r.dilaporkan_id}` }),
      el('div', { class: 'r', text: new Date(r.created_at).toLocaleString('id-ID') }),
      el('div', { class: 'r', text: r.reason || '(tanpa alasan)' }),
    ),
  );
}

// Satu peristiwa masuk: perangkat + lokasi IP. UA mentah disimpan di title
// agar tetap bisa diperiksa tanpa memenuhi kartu.
export function adminLoginRow(l) {
  const lokasi = l.geo_city
    ? [l.geo_city, l.geo_region, l.geo_country].filter(Boolean).join(', ')
    : 'lokasi IP belum tersedia';
  return el(
    'div',
    { class: 'user-card', title: l.user_agent || undefined },
    el(
      'div',
      { class: 'who' },
      el('div', {
        class: 'n',
        text: `${l.nickname ?? '(akun terhapus)'} — ${l.event === 'register' ? 'DAFTAR' : 'MASUK'}`,
      }),
      el('div', { class: 'id', text: `${l.public_id ?? '-'} • ${l.login_id ?? '-'} • IP ${l.ip}` }),
      el('div', {
        class: 'r',
        text: `${l.device ?? 'perangkat tidak dikenal'} • ${l.os ?? 'OS tidak dikenal'} • ${l.browser ?? 'browser tidak dikenal'}`,
      }),
      el('div', { class: 'r', text: `${lokasi}${l.geo_isp ? ` • ${l.geo_isp}` : ''}` }),
      el('div', { class: 'r', text: new Date(l.created_at).toLocaleString('id-ID') }),
    ),
  );
}

/* ---------- kerangka aplikasi + HUD ---------- */

export function renderAppShell({ onSearch, onToggleVisibility, onOpenFriends, onOpenMe, onLogout, onOpenAdmin }) {
  const app = document.getElementById('app');
  app.replaceChildren();

  const mapDiv = el('div', { id: 'map' });

  // pencarian
  const drop = el('div', { class: 'search-drop pixel-panel hidden' });
  const searchInput = el('input', {
    id: 'search',
    placeholder: 'Cari wilayah, nickname, atau ID publik...',
    autocomplete: 'off',
    'aria-label': 'Cari wilayah, nickname, atau ID publik',
  });
  let debounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      drop.classList.add('hidden');
      return;
    }
    debounce = setTimeout(() => onSearch(q), 250);
  });
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) drop.classList.remove('hidden');
  });
  searchInput.addEventListener('blur', () => setTimeout(() => drop.classList.add('hidden'), 200));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') drop.classList.add('hidden');
  });

  const hudSearch = el('div', { class: 'hud-search' }, searchInput, drop);

  // saklar visibilitas — button semantik, bisa dioperasikan keyboard
  const swLbl = el('span', { class: 'lbl', text: 'TAMPILKAN SAYA DI PETA' });
  const swLblShort = el('span', { class: 'lbl-short', text: 'DI PETA' });
  const sw = el(
    'button',
    {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-checked': 'false',
      'aria-label': 'Tampilkan saya di peta',
    },
    el('span', { class: 'track', 'aria-hidden': 'true' }, el('span', { class: 'knob' })),
    swLbl,
    swLblShort,
  );
  sw.addEventListener('click', () => onToggleVisibility());

  // tombol teman
  const badge = el('span', { class: 'badge hidden' });
  const msgBadge = el('span', { class: 'badge badge-msg hidden' });
  const btnFriends = el(
    'button',
    { class: 'btn btn-ghost', text: 'TEMAN', 'aria-label': 'Daftar teman dan permintaan' },
    badge,
    msgBadge,
  );
  btnFriends.addEventListener('click', () => onOpenFriends());

  // chip profil sendiri — button yang membuka Profilku
  const chip = el('button', { class: 'chip', type: 'button', 'aria-label': 'Buka Profilku' });
  chip.addEventListener('click', () => onOpenMe());

  const hud = el(
    'header',
    { class: 'hud' },
    el('div', { class: 'logo-small logo' }, 'TEMAN', el('span', {}, 'PETA')),
    hudSearch,
    el(
      'div',
      { class: 'hud-right' },
      sw,
      btnFriends,
      chip,
      onOpenAdmin
        ? el('button', { class: 'btn btn-ghost', text: 'ADMIN', 'aria-label': 'Kembali ke halaman admin', onclick: onOpenAdmin })
        : null,
      el('button', { class: 'btn btn-ghost', text: 'KELUAR', onclick: onLogout }),
    ),
  );

  const panel = el('aside', { class: 'panel pixel-panel hidden' }, el('div', { class: 'panel-body' }));
  const chatRoot = el('section', { class: 'chat pixel-panel hidden' });

  app.append(el('div', { class: 'screen-app' }, mapDiv, hud, panel, chatRoot));

  function setMe(me) {
    chip.replaceChildren();
    chip.append(
      el('span', { class: 'nick', text: me.nickname }),
      el('span', { class: 'pid', text: me.publicId }),
    );
    setSwitch(Boolean(me.visibility));
  }

  function setRequestsBadge(n) {
    badge.classList.toggle('hidden', n === 0);
    badge.textContent = String(n);
  }

  function setMsgBadge(n) {
    msgBadge.classList.toggle('hidden', n === 0);
    msgBadge.textContent = String(n);
  }

  function setSwitch(on) {
    sw.classList.toggle('on', Boolean(on));
    sw.setAttribute('aria-checked', String(Boolean(on)));
  }

  // Teks sementara pada saklar (mis. "MENDETEKSI LOKASI..."), null = kembalikan.
  function setLocStatus(text) {
    swLbl.textContent = text ?? 'TAMPILKAN SAYA DI PETA';
    swLblShort.textContent = text ?? 'DI PETA';
  }

  return {
    mapDiv,
    panel,
    chatRoot,
    searchInput,
    setMe,
    setRequestsBadge,
    setMsgBadge,
    setSwitch,
    setLocStatus,
    searchDrop: drop,
  };
}

export function setSearchResults(drop, groups) {
  drop.replaceChildren();
  let total = 0;
  for (const g of groups) {
    if (g.items.length === 0) continue;
    total += g.items.length;
    drop.append(el('div', { class: 'drop-head', text: g.title }));
    for (const item of g.items) {
      drop.append(
        el(
          'button',
          { class: 'drop-item', type: 'button' },
          el('span', { text: item.label }),
          item.sub ? el('span', { class: 'sub', text: item.sub }) : null,
        ),
      );
      drop.lastChild.addEventListener('click', () => {
        drop.classList.add('hidden');
        item.onClick();
      });
    }
  }
  if (total === 0) drop.append(el('div', { class: 'drop-empty', text: 'Tidak ada hasil.' }));
  drop.classList.remove('hidden');
}

/* ---------- panel ---------- */

function panelFrame(panel, title, onClose) {
  panel.classList.remove('hidden');
  panel.replaceChildren();
  panel.append(
    el(
      'div',
      { class: 'panel-head' },
      el('h2', { text: title }),
      el('button', { class: 'close-x', text: 'X', 'aria-label': `Tutup panel ${title}`, onclick: onClose }),
    ),
    el('div', { class: 'panel-body' }),
  );
  return panel.querySelector('.panel-body');
}

export function hidePanel(panel) {
  panel.classList.add('hidden');
}

export function userCardNode(u, { onClick, actions = [], badge } = {}) {
  const initials = (u.nickname?.[0] ?? '?').toUpperCase();
  return el(
    'div',
    { class: `user-card${u.isFriend ? '' : ' stranger'}` },
    el('div', { class: 'avatar', text: initials }),
    el(
      'div',
      { class: 'who' },
      el(
        'div',
        { class: 'n' },
        el('span', { class: `dot${u.online ? ' on' : ''}` }),
        u.nickname,
        badge ? el('span', { class: 'badge badge-msg', text: String(badge) }) : null,
      ),
      el('div', { class: 'id', text: u.publicId }),
      el('div', { class: 'r', text: u.region?.name ?? 'wilayah disembunyikan' }),
    ),
    actions.length > 0
      ? el('div', { class: 'actions' }, ...actions)
      : el('button', { class: 'close-x', text: '›', 'aria-label': `Buka profil ${u.nickname}`, onclick: onClick }),
  );
}

export function renderFriendsPanel(panel, { friends, requests, unread = {}, onClose, onOpenChat, onOpenProfile, onAccept, onDecline }) {
  const body = panelFrame(panel, 'TEMAN & PERMINTAAN', onClose);

  if (requests.incoming.length > 0 || requests.outgoing.length > 0) {
    body.append(el('div', { class: 'section-title', text: 'PERMINTAAN MASUK' }));
    if (requests.incoming.length === 0) {
      body.append(el('div', { class: 'empty', text: 'Tidak ada permintaan masuk.' }));
    }
    for (const r of requests.incoming) {
      body.append(
        userCardNode(
          { ...r.from, isFriend: false },
          {
            actions: [
              el('button', { class: 'btn', text: 'TERIMA', onclick: () => onAccept(r.id) }),
              el('button', { class: 'btn btn-ghost', text: 'TOLAK', onclick: () => onDecline(r.id) }),
            ],
          },
        ),
      );
    }
    if (requests.outgoing.length > 0) {
      body.append(el('div', { class: 'section-title', text: 'MENUNGGU JAWABAN' }));
      for (const r of requests.outgoing) {
        body.append(
          userCardNode({ ...r.to, isFriend: false }, {}),
        );
      }
    }
  }

  body.append(el('div', { class: 'section-title', text: `DAFTAR TEMAN (${friends.length})` }));
  if (friends.length === 0) {
    body.append(
      el('div', {
        class: 'empty',
        text: 'Belum punya teman. Cari nickname atau ID publik di kolom pencarian, atau jelajahi wilayah lewat peta.',
      }),
    );
  }
  for (const f of friends) {
    body.append(
      userCardNode(f, {
        badge: unread[f.publicId],
        actions: [
          el('button', { class: 'btn', text: 'CHAT', onclick: () => onOpenChat(f) }),
          el('button', { class: 'btn btn-ghost', text: 'PROFIL', onclick: () => onOpenProfile(f.publicId) }),
        ],
      }),
    );
  }
}

export function renderRegionPanel(panel, { region, users, onClose, onOpenProfile }) {
  const body = panelFrame(panel, region.name.toUpperCase(), onClose);
  body.append(el('div', { class: 'section-title', text: `PENGGUNA DI WILAYAH INI (${users.length})` }));
  if (users.length === 0) {
    body.append(el('div', { class: 'empty', text: 'Belum ada pengguna bervisibilitas nyala di sini.' }));
  }
  for (const u of users) {
    body.append(
      userCardNode(u, {
        actions: [
          u.isFriend
            ? null
            : el('button', { class: 'btn btn-ghost', text: 'PROFIL', onclick: () => onOpenProfile(u.publicId) }),
        ],
      }),
    );
  }
}

export function renderProfilePanel(panel, { user, relation, blockedByMe, onClose, onAddFriend, onChat, onUnfriend, onBlock, onReport }) {
  const body = panelFrame(panel, 'PROFIL', onClose);
  const isMe = relation === 'self';

  const btns = [];
  if (isMe) {
    body.append(el('p', { text: 'Ini profil kamu sendiri.' }));
  } else if (blockedByMe) {
    body.append(el('p', { text: 'Kamu memblokir pengguna ini.' }));
    btns.push(el('button', { class: 'btn btn-ghost', text: 'BATALKAN BLOKIR', onclick: onBlock }));
  } else {
    if (relation === 'friend') {
      btns.push(el('button', { class: 'btn', text: 'BUKA CHAT', onclick: onChat }));
      btns.push(el('button', { class: 'btn btn-ghost', text: 'HAPUS TEMAN', onclick: onUnfriend }));
    } else if (relation === 'outgoing') {
      btns.push(el('button', { class: 'btn btn-ghost', disabled: 'disabled', text: 'PERMINTAAN TERKIRIM' }));
    } else if (relation === 'incoming') {
      btns.push(el('button', { class: 'btn btn-ghost', disabled: 'disabled', text: 'MENGIRIMMU PERMINTAAN' }));
    } else {
      btns.push(el('button', { class: 'btn', text: 'TAMBAH TEMAN', onclick: onAddFriend }));
    }
    btns.push(el('button', { class: 'btn btn-ghost', text: 'LAPORKAN', onclick: onReport }));
    btns.push(el('button', { class: 'btn btn-danger', text: 'BLOKIR', onclick: onBlock }));
  }

  body.append(
    el(
      'div',
      { class: 'profile' },
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'NICKNAME' }),
        el('div', { text: user.nickname }),
      ),
      // Bio publik: ditampilkan apa adanya sebagai teks (baris baru dihormati CSS).
      user.bio
        ? el(
            'div',
            { class: 'row' },
            el('div', { class: 'k', text: 'BIO' }),
            el('div', { class: 'bio-text', text: user.bio }),
          )
        : null,
      el('div', { class: 'k', text: 'ID PUBLIK' }),
      el('div', { class: 'big-id', text: user.publicId }),
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'WILAYAH' }),
        el('div', { text: user.region?.name ?? 'disembunyikan' }),
      ),
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'STATUS' }),
        el('div', {}, el('span', { class: `dot${user.online ? ' on' : ''}` }), user.online ? 'online' : 'offline'),
      ),
      btns.length > 0 ? el('div', { class: 'btns' }, ...btns) : null,
    ),
  );
}

export function renderMePanel(panel, { me, onClose, onSave, onCopyId, onLogout }) {
  const body = panelFrame(panel, 'PROFILKU', onClose);
  const nick = el('input', { value: me.nickname, maxlength: '24' });
  // Nilai awal textarea lewat text node — atribut `value` tidak berlaku di <textarea>.
  const bio = el(
    'textarea',
    {
      class: 'bio-input',
      maxlength: String(BIO_MAX),
      rows: '3',
      placeholder: 'Ceritakan sedikit tentang dirimu (opsional)',
      'aria-label': 'Bio profil',
    },
    me.bio ?? '',
  );
  const bioCount = el('div', { class: 'bio-count', text: `${(me.bio ?? '').length}/${BIO_MAX}` });
  bio.addEventListener('input', () => {
    bioCount.textContent = `${bio.value.length}/${BIO_MAX}`;
  });
  body.append(
    el(
      'div',
      { class: 'profile' },
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'ID LOGIN (PRIVAT)' }),
        el('div', { text: me.loginId }),
      ),
      el('div', { class: 'k', text: 'ID PUBLIK' }),
      el(
        'div',
        { class: 'copy-row' },
        el('div', { class: 'big-id', text: me.publicId }),
        el('button', {
          class: 'btn btn-ghost',
          text: 'SALIN ID',
          'aria-label': `Salin ID publik ${me.publicId}`,
          onclick: () => onCopyId?.(),
        }),
      ),
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'NICKNAME' }),
        nick,
      ),
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'BIO' }),
        bio,
        el(
          'div',
          { class: 'bio-meta' },
          el('span', { class: 'bio-hint', text: 'Tampil ke siapa pun yang membuka profilmu.' }),
          bioCount,
        ),
      ),
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'k', text: 'WILAYAH' }),
        el('div', { text: me.region?.name ?? 'belum disetel — nyalakan "Tampilkan saya di peta" untuk mendeteksi otomatis' }),
      ),
      el('p', {
        class: 'hint-privacy',
        text: 'Dua pengaturan berbeda: saklar "Tampilkan saya di peta" mengatur wilayahmu terlihat; ID publikmu tetap bisa dicari siapa pun yang mengetahuinya.',
      }),
      el(
        'div',
        { class: 'btns' },
        el('button', {
          class: 'btn',
          text: 'SIMPAN PERUBAHAN',
          onclick: () => onSave?.({ nickname: nick.value.trim(), bio: bio.value }),
        }),
        el('button', { class: 'btn btn-ghost', text: 'KELUAR', onclick: onLogout }),
      ),
    ),
  );
  nick.focus();
}

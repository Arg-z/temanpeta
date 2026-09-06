// Titik masuk aplikasi: state, layar, peta, WS, dan semua aksi pengguna.
import { api } from './api.js';
import { createSocket } from './ws.js';
import { initMap } from './map.js';
import { createChat } from './chat.js';
import {
  el,
  renderAuth,
  renderAppShell,
  setSearchResults,
  renderFriendsPanel,
  renderRegionPanel,
  renderProfilePanel,
  renderMePanel,
  renderOnboarding,
  removeOnboarding,
  renderAdmin,
  adminUserRow,
  adminReportRow,
  hidePanel,
  toast,
  modal,
} from './ui.js';
import './style.css';

const state = {
  me: null,
  friends: [],
  requests: { incoming: [], outgoing: [] },
  ui: null,
  map: null,
  chat: null,
  socket: null,
  regionCtx: null, // { region, users } wilayah yang sedang dilihat
  unread: new Map(), // publicId -> jumlah pesan belum dibaca
  presenceTimer: null,
};

// ---- onboarding pengguna baru ----
const sudahOnboard = () => localStorage.getItem('tp_onboard_done') === '1';

function dismissOnboarding() {
  localStorage.setItem('tp_onboard_done', '1');
  removeOnboarding(state.ui?.mapDiv);
}

function maybeShowOnboarding() {
  if (!state.ui || state.friends.length > 0 || sudahOnboard()) {
    removeOnboarding(state.ui?.mapDiv);
    return;
  }
  renderOnboarding(state.ui.mapDiv, {
    onSearch: () => {
      dismissOnboarding();
      state.ui.searchInput.focus();
    },
    onClose: dismissOnboarding,
  });
}

function updateUnreadBadge() {
  let total = 0;
  for (const n of state.unread.values()) total += n;
  state.ui?.setMsgBadge(total);
}

function nicknameOf(publicId) {
  return (
    state.friends.find((f) => f.publicId === publicId)?.nickname ?? publicId
  );
}

// Titik peta hanya untuk teman yang sedang online — offline = titik hilang.
// Aturan saling visibilitas: saklar mati = tidak melihat titik siapa pun,
// KECUALI admin (mode pengamat: tak terlihat orang lain, tapi tetap melihat).
const bisaLihatTitik = () => Boolean(state.me?.visibility || state.me?.isAdmin);

function syncFriendMarkers() {
  if (!bisaLihatTitik()) {
    state.map.clearOthers();
    return;
  }
  state.map.setFriends(state.friends.filter((f) => f.online && f.visibility));
}

/* ---------- layar ---------- */

function showAuth() {
  state.socket?.close();
  state.socket = null;
  clearInterval(state.presenceTimer);
  state.presenceTimer = null;
  renderAuth({
    onLogin: async (loginId, password) => {
      // Sesi disimpan server sebagai cookie HttpOnly — tidak ada token di JS.
      const { user } = await api('/login', { method: 'POST', body: { loginId, password } });
      enterApp(user);
    },
    onRegister: async (loginId, password, nickname) => {
      const { user } = await api('/register', { method: 'POST', body: { loginId, password, nickname } });
      enterApp(user);
      toast(`ID publik kamu: ${user.publicId} — bagikan ini agar bisa dicari.`);
    },
  });
}

function enterApp(me) {
  state.me = me;
  if (me.isAdmin) {
    enterAdmin(me);
    return;
  }
  enterShell(me);
}

/* ---------- halaman admin ---------- */

function enterAdmin(me) {
  const ui = renderAdmin({
    me,
    onLogout: handleLogout,
    onOpenMap: () => enterShell(me),
  });

  async function loadUsers(q = '') {
    try {
      const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
      ui.userList.replaceChildren();
      if (users.length === 0) {
        ui.userList.append(el('div', { class: 'empty', text: 'Tidak ada pengguna yang cocok.' }));
      }
      for (const u of users) {
        ui.userList.append(
          adminUserRow(u, {
            onBan: (usr) =>
              modal({
                title: usr.banned ? 'BUKA BLOKIR' : 'BLOKIR PENGGUNA',
                body: usr.banned
                  ? `Buka blokir ${usr.nickname}? Dia bisa masuk lagi seperti biasa.`
                  : `Blokir ${usr.nickname}? Sesi aktifnya langsung ditutup dan dia tidak bisa masuk sampai dibuka.`,
                actions: [
                  { label: 'BATAL', kind: 'btn-ghost' },
                  {
                    label: usr.banned ? 'UNBAN' : 'BAN',
                    kind: usr.banned ? 'btn' : 'btn-danger',
                    onClick: async () => {
                      try {
                        await api('/admin/ban', {
                          method: 'POST',
                          body: { publicId: usr.public_id, banned: !usr.banned },
                        });
                        toast(usr.banned ? 'Blokir dibuka.' : 'Pengguna diblokir.');
                        loadUsers(ui.input.value.trim());
                      } catch (err) {
                        toast(err.message, true);
                      }
                    },
                  },
                ],
              }),
          }),
        );
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function loadReports() {
    try {
      const { reports } = await api('/admin/reports');
      ui.reportList.replaceChildren();
      if (reports.length === 0) {
        ui.reportList.append(el('div', { class: 'empty', text: 'Belum ada laporan masuk.' }));
      }
      for (const r of reports) ui.reportList.append(adminReportRow(r));
    } catch (err) {
      toast(err.message, true);
    }
  }

  let debounce = null;
  ui.input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadUsers(ui.input.value.trim()), 250);
  });

  loadUsers();
  loadReports();
}

/* ---------- kerangka aplikasi (peta) ---------- */

function enterShell(me) {
  state.me = me;

  state.ui = renderAppShell({
    onSearch: handleSearch,
    onToggleVisibility: handleToggleVisibility,
    onOpenFriends: openFriendsPanel,
    onOpenMe: openMePanel,
    onLogout: handleLogout,
    // Akun admin bisa pulang ke halaman admin dari dalam peta.
    onOpenAdmin: me.isAdmin
      ? () => {
          state.socket?.close();
          state.socket = null;
          clearInterval(state.presenceTimer);
          state.presenceTimer = null;
          state.map?.map.remove();
          enterAdmin(state.me);
        }
      : undefined,
  });

  state.map = initMap(state.ui.mapDiv, {
    onMarkerClick: (user) => openProfile(user.publicId),
  });
  state.ui.setMe(me);
  state.map.setMe(me); // titik sendiri langsung tampil bila visibilitas nyala

  state.chat = createChat(state.ui.chatRoot, {
    onTyping: (to) => state.socket?.send({ type: 'typing', to }),
    onOpenProfile: (publicId) => openProfile(publicId),
    // Pesan tampil di chat terbuka = dianggap terbaca sampai id terakhir.
    onSeen: (publicId, lastId) => markSeen(publicId, lastId),
  });

  state.socket = createSocket({ onEvent: handleWsEvent });

  refreshFriends();
  refreshRequests();
  refreshPresence();
  // Jaring-jaring pengaman: sinkron ulang titik berkala (koneksi HP yang
  // tertidur bisa melewatkan event realtime saat lama di latar belakang).
  clearInterval(state.presenceTimer);
  state.presenceTimer = setInterval(refreshPresence, 60_000);
}

/* ---------- pemuatan data ---------- */

// Penanda "pesan terakhir yang sudah kulihat" per pasangan teman —
// bertahan di localStorage sehingga logout/login tidak meresetnya.
const seenKey = (friendId) => `tp_seen_${state.me.publicId}_${friendId}`;

function markSeen(friendId, lastId) {
  if (lastId != null) {
    try {
      localStorage.setItem(seenKey(friendId), String(lastId));
    } catch { /* penyimpanan penuh — abaikan */ }
  }
  if (state.unread.delete(friendId)) updateUnreadBadge();
}

// Hitung ulang pesan belum dibaca dari riwayat: pesan terakhir dari teman
// yang belum terlewati penanda = belum dibaca (menangani pesan saat offline).
async function syncUnreadFromHistory() {
  if (!state.me || state.friends.length === 0) return;
  await Promise.all(
    state.friends.map(async (f) => {
      try {
        const { messages } = await api(`/messages/${f.publicId}?limit=20`);
        const seen = Number(localStorage.getItem(seenKey(f.publicId)) ?? 0);
        let n = 0;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const m = messages[i];
          if (m.mine || m.id <= seen) break; // sudah terbaca sampai sini
          n += 1;
        }
        if (n > 0) state.unread.set(f.publicId, n);
        else state.unread.delete(f.publicId);
      } catch { /* satu teman gagal — lanjut yang lain */ }
    }),
  );
  updateUnreadBadge();
}

// Peta global: semua user lain yang online + visibilitas nyala.
function refreshPresence() {
  if (!bisaLihatTitik()) return;
  api('/presence-map')
    .then(({ users }) => {
      if (!state.me?.visibility) return;
      for (const u of users) {
        if (state.friends.some((f) => f.publicId === u.publicId)) continue;
        state.map.showUser(u, 'stranger');
      }
    })
    .catch(() => {});
}

async function refreshFriends() {
  try {
    const { friends } = await api('/friends-map');
    state.friends = friends;
    syncFriendMarkers();
    maybeShowOnboarding();
    await syncUnreadFromHistory(); // hitung ulang belum-dibaca (pesan saat offline)
    if (!state.ui.panel.classList.contains('hidden') && state.ui.panel.dataset.view === 'friends') {
      openFriendsPanel();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function refreshRequests() {
  try {
    state.requests = await api('/friend-requests');
    state.ui.setRequestsBadge(state.requests.incoming.length);
    if (!state.ui.panel.classList.contains('hidden') && state.ui.panel.dataset.view === 'friends') {
      openFriendsPanel();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- event WebSocket ---------- */

function handleWsEvent(ev) {
  switch (ev.type) {
    case 'message.new':
      if (state.chat.isActive(ev.message.from)) {
        state.chat.append(ev.message);
      } else {
        // Pesan belum dibaca: toast sementara + badge yang bertahan sampai chat dibuka.
        const from = ev.message.from;
        state.unread.set(from, (state.unread.get(from) ?? 0) + 1);
        updateUnreadBadge();
        if (!state.ui.panel.classList.contains('hidden') && state.ui.panel.dataset.view === 'friends') {
          openFriendsPanel();
        }
        toast(`Pesan baru dari ${nicknameOf(from)}`);
      }
      break;
    case 'typing':
      if (state.chat.isActive(ev.from)) state.chat.showTyping();
      break;
    case 'friend_request.new':
      state.requests.incoming.push(ev.request);
      state.ui.setRequestsBadge(state.requests.incoming.length);
      toast(`${ev.request.from.nickname} mengirim permintaan pertemanan`);
      break;
    case 'friend_request.accepted': {
      if (!state.friends.some((f) => f.publicId === ev.friend.publicId)) {
        state.friends.push(ev.friend);
        if (ev.friend.online && ev.friend.visibility && state.me?.visibility) {
          state.map.showUser(ev.friend, 'friend');
        }
      }
      toast(`${ev.friend.nickname} sekarang temanmu`);
      break;
    }
    case 'friend.online':
    case 'friend.offline': {
      const f = state.friends.find((x) => x.publicId === ev.publicId);
      if (f) {
        f.online = ev.type === 'friend.online';
        // Titik realtime: muncul saat online, hilang saat offline.
        // Saling visibilitas: hanya digambar bila dua-duanya tampil di peta.
        if (bisaLihatTitik() && f.online && f.visibility) state.map.showUser(f, 'friend');
        else state.map.removeUser(f.publicId);
        if (state.ui.panel.dataset.view === 'friends' && !state.ui.panel.classList.contains('hidden')) {
          openFriendsPanel();
        }
      }
      break;
    }
    case 'user.online':
    case 'user.offline': {
      // Orang lain di seluruh peta (bukan teman — teman lewat friend.*).
      if (!bisaLihatTitik()) break; // saklar mati (non-admin) = tidak melihat siapa pun
      if (state.friends.some((f) => f.publicId === ev.publicId)) break;
      if (ev.type === 'user.online') {
        state.map.showUser(
          { publicId: ev.publicId, nickname: ev.nickname, lat: ev.lat, lng: ev.lng, online: true },
          'stranger',
        );
      } else {
        state.map.removeUser(ev.publicId);
        const u = state.regionCtx?.users.find((x) => x.publicId === ev.publicId);
        if (u) {
          u.online = false;
          if (state.ui.panel.dataset.view === 'region' && !state.ui.panel.classList.contains('hidden')) {
            renderRegionPanel(state.ui.panel, {
              region: state.regionCtx.region,
              users: state.regionCtx.users,
              onClose: closePanel,
              onOpenProfile: openProfile,
            });
          }
        }
      }
      break;
    }
    case 'user.visibility': {
      // Seseorang menyalakan/mematikan "tampilkan saya di peta" —
      // titiknya langsung muncul/hilang bagi yang lain.
      if (ev.publicId === state.me?.publicId) break;
      const f = state.friends.find((x) => x.publicId === ev.publicId);
      if (f) {
        f.visibility = ev.visible;
        if (bisaLihatTitik() && ev.visible && f.online) state.map.showUser(f, 'friend');
        else state.map.removeUser(ev.publicId);
      } else if (bisaLihatTitik() && ev.visible) {
        state.map.showUser(
          { publicId: ev.publicId, nickname: ev.nickname, lat: ev.lat, lng: ev.lng, online: true },
          'stranger',
        );
      } else {
        state.map.removeUser(ev.publicId);
      }
      const u = state.regionCtx?.users.find((x) => x.publicId === ev.publicId);
      if (u) {
        u.visibility = ev.visible;
        if (!ev.visible && state.ui.panel.dataset.view === 'region' && !state.ui.panel.classList.contains('hidden')) {
          renderRegionPanel(state.ui.panel, {
            region: state.regionCtx.region,
            users: state.regionCtx.users,
            onClose: closePanel,
            onOpenProfile: openProfile,
          });
        }
      }
      break;
    }
    case 'friend.removed': {
      const nama = nicknameOf(ev.publicId);
      state.friends = state.friends.filter((f) => f.publicId !== ev.publicId);
      state.map.removeUser(ev.publicId);
      if (state.chat.isActive(ev.publicId)) state.chat.close();
      toast(`${nama} menghapus pertemanan`);
      break;
    }
    default:
      break;
  }
}

/* ---------- pencarian ---------- */

async function handleSearch(q) {
  try {
    dismissOnboarding(); // mulai mencari = sudah pakai aplikasi
    const [regions, users] = await Promise.all([
      api(`/regions?q=${encodeURIComponent(q)}`),
      api(`/users?q=${encodeURIComponent(q)}`),
    ]);
    setSearchResults(state.ui.searchDrop, [
      {
        title: 'WILAYAH',
        items: regions.regions.map((r) => ({
          label: r.name,
          sub: r.kind === 'province' ? 'provinsi' : (r.type ?? 'kota'),
          onClick: () => openRegion(r),
        })),
      },
      {
        title: 'PENGGUNA',
        items: users.users.map((u) => ({
          label: u.nickname,
          sub: u.publicId,
          onClick: () => openProfile(u.publicId),
        })),
      },
    ]);
  } catch (err) {
    toast(err.message, true);
  }
}

async function openRegion(region) {
  try {
    dismissOnboarding();
    state.chat?.close(); // satu permukaan pada satu waktu
    const res = await api(`/users/region/${region.code}`);
    state.regionCtx = res;
    state.regionCtx.regionKind = region.kind; // dijaga untuk muat-ulang realtime
    state.map.flyTo(res.region.lat, res.region.lng, region.kind === 'city' ? 9 : 6.5);
    state.map.setStrangers(bisaLihatTitik() ? res.users.filter((u) => u.online) : []);
    state.ui.panel.dataset.view = 'region';
    renderRegionPanel(state.ui.panel, {
      region: res.region,
      users: res.users,
      onClose: closePanel,
      onOpenProfile: openProfile,
    });
  } catch (err) {
    toast(err.message, true);
  }
}

function closePanel() {
  hidePanel(state.ui.panel);
  state.ui.panel.dataset.view = '';
  state.map.clearStrangers();
}

/* ---------- profil ---------- */

async function openProfile(publicId) {
  try {
    dismissOnboarding();
    state.chat?.close(); // sembunyikan chat agar tombol aksi profil tidak tertutup;
    // untuk kembali ke chat, tombol "BUKA CHAT" tersedia di profil teman.
    const res = await api(`/users/${publicId}`);
    state.ui.panel.dataset.view = 'profile';
    renderProfilePanel(state.ui.panel, {
      user: res.user,
      relation: res.relation,
      blockedByMe: res.blockedByMe,
      onClose: closePanel,
      onAddFriend: () => addFriend(publicId),
      onChat: () => {
        const friend = state.friends.find((f) => f.publicId === publicId) ?? res.user;
        state.chat.open(friend);
      },
      onUnfriend: () =>
        modal({
          title: 'HAPUS TEMAN',
          body: `Hapus ${res.user.nickname} dari daftar teman? Riwayat chat tetap tersimpan.`,
          actions: [
            { label: 'BATAL', kind: 'btn-ghost' },
            { label: 'HAPUS', kind: 'btn-danger', onClick: () => unfriend(publicId) },
          ],
        }),
      onBlock: () => (res.blockedByMe ? unblock(publicId) : confirmBlock(res.user)),
      onReport: () =>
        modal({
          title: 'LAPORKAN',
          body: `Laporkan ${res.user.nickname} kepada admin?`,
          textarea: {
            placeholder: 'Alasan laporan (opsional, maks 500 karakter)',
            maxLength: 500,
          },
          actions: [
            { label: 'BATAL', kind: 'btn-ghost' },
            {
              label: 'LAPOR',
              kind: 'btn-danger',
              onClick: async (reason) => {
                try {
                  await api('/reports', {
                    method: 'POST',
                    body: { publicId, reason: (reason ?? '').trim() },
                  });
                  toast('Laporan terkirim. Terima kasih.');
                } catch (err) {
                  toast(err.message, true);
                }
              },
            },
          ],
        }),
    });
  } catch (err) {
    toast(err.message, true);
  }
}

async function addFriend(publicId) {
  try {
    await api('/friend-requests', { method: 'POST', body: { publicId } });
    toast('Permintaan pertemanan terkirim.');
    openProfile(publicId);
  } catch (err) {
    toast(err.message, true);
  }
}

async function unfriend(publicId) {
  try {
    await api(`/friends/${publicId}`, { method: 'DELETE' });
    state.friends = state.friends.filter((f) => f.publicId !== publicId);
    state.map.removeUser(publicId);
    if (state.chat.isActive(publicId)) state.chat.close();
    closePanel();
    toast('Pertemanan dihapus.');
  } catch (err) {
    toast(err.message, true);
  }
}

function confirmBlock(user) {
  modal({
    title: 'BLOKIR PENGGUNA',
    body: `Blokir ${user.nickname}? Pertemanan diputus dan dia tidak bisa mengirim apa pun ke kamu.`,
    actions: [
      { label: 'BATAL', kind: 'btn-ghost' },
      {
        label: 'BLOKIR',
        kind: 'btn-danger',
          onClick: async () => {
            try {
              await api('/blocks', { method: 'POST', body: { publicId: user.publicId } });
              state.friends = state.friends.filter((f) => f.publicId !== user.publicId);
              state.map.removeUser(user.publicId);
              if (state.chat.isActive(user.publicId)) state.chat.close();
              toast(`${user.nickname} diblokir.`);
              openProfile(user.publicId);
            } catch (err) {
              toast(err.message, true);
            }
          },
      },
    ],
  });
}

async function unblock(publicId) {
  try {
    await api(`/blocks/${publicId}`, { method: 'DELETE' });
    toast('Blokir dibuka.');
    openProfile(publicId);
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- panel teman & profil sendiri ---------- */

function openFriendsPanel() {
  state.chat?.close(); // satu permukaan pada satu waktu
  state.ui.panel.dataset.view = 'friends';
  renderFriendsPanel(state.ui.panel, {
    friends: state.friends,
    requests: state.requests,
    unread: Object.fromEntries(state.unread),
    onClose: closePanel,
    onOpenChat: (f) => {
      closePanel();
      state.chat.open(f);
    },
    onOpenProfile: openProfile,
    onAccept: async (id) => {
      try {
        const res = await api(`/friend-requests/${id}/accept`, { method: 'POST' });
        state.requests.incoming = state.requests.incoming.filter((r) => r.id !== id);
        state.ui.setRequestsBadge(state.requests.incoming.length);
        if (!state.friends.some((f) => f.publicId === res.friend.publicId)) {
          state.friends.push(res.friend);
          if (res.friend.online) state.map.showUser(res.friend, 'friend');
        }
        toast(`${res.friend.nickname} sekarang temanmu.`);
        openFriendsPanel();
      } catch (err) {
        toast(err.message, true);
      }
    },
    onDecline: async (id) => {
      try {
        await api(`/friend-requests/${id}`, { method: 'DELETE' });
        state.requests.incoming = state.requests.incoming.filter((r) => r.id !== id);
        state.ui.setRequestsBadge(state.requests.incoming.length);
        openFriendsPanel();
      } catch (err) {
        toast(err.message, true);
      }
    },
  });
}

function openMePanel() {
  state.chat?.close(); // satu permukaan pada satu waktu
  state.ui.panel.dataset.view = 'me';
  renderMePanel(state.ui.panel, {
    me: state.me,
    onClose: closePanel,
    onCopyId: async () => {
      try {
        await navigator.clipboard.writeText(state.me.publicId);
        toast('ID berhasil disalin.');
      } catch {
        toast('Gagal menyalin — salin manual: ' + state.me.publicId, true);
      }
    },
    onSaveNickname: async (nickname) => {
      try {
        const { user } = await api('/me', { method: 'PATCH', body: { nickname } });
        state.me = user;
        state.ui.setMe(user);
        toast('Nickname disimpan.');
      } catch (err) {
        toast(err.message, true);
      }
    },
    onLogout: handleLogout,
  });
}

/* ---------- visibilitas lokasi ---------- */

function geoPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser tidak mendukung deteksi lokasi.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 300_000,
    });
  });
}

// Ukur ulang lokasi perangkat dan perbarui wilayah tersimpan.
// Hanya dipakai saat pertama kali / tombol PERBARUI LOKASI — bukan saat toggle.
async function updateRegionFromDevice() {
  const pos = await geoPosition();
  const { region, user } = await api('/me/location', {
    method: 'POST',
    body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
  });
  state.me = user;
  state.ui.setMe(user);
  state.map.setMe(user);
  return region;
}

const errLokasi = (err) => {
  const code = err?.code;
  if (code === 1 || err instanceof GeolocationPositionError) {
    toast('Izin lokasi ditolak. Aktifkan izin lokasi di browser, lalu coba lagi.', true);
  } else if (code === 2) {
    toast('Lokasi tidak tersedia. Pastikan layanan lokasi perangkat aktif, lalu coba lagi.', true);
  } else if (code === 3) {
    toast('Waktu deteksi lokasi habis. Coba lagi.', true);
  } else {
    toast(err.message, true);
  }
};

async function handleToggleVisibility() {
  if (state.me.visibility) {
    try {
      const { user } = await api('/me', { method: 'PATCH', body: { visibility: false } });
      state.me = user;
      state.ui.setMe(user);
      state.map.setMe(user);
      if (state.me.isAdmin) {
        // Admin = mode pengamat: tetap melihat semua titik walau tak terlihat.
        syncFriendMarkers();
        refreshPresence();
        toast('Lokasimu disembunyikan — mode admin: titik pengguna lain tetap terlihat.');
      } else {
        // Saling visibilitas: saklar mati = semua titik orang lain ikut hilang.
        syncFriendMarkers();
        state.map.clearStrangers();
        toast('Lokasimu disembunyikan — titik pengguna lain juga disembunyikan.');
      }
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  // Wilayah yang sudah tersimpan tidak diukur ulang — ON/OFF tidak memindahkan
  // posisi. Deteksi perangkat hanya saat pertama kali (belum ada wilayah),
  // dengan penjelasan privasi sebelum izin browser diminta.
  if (!state.me.region) {
    modal({
      title: 'TAMPILKAN SAYA DI PETA',
      body: 'Wilayah perkiraanmu akan terlihat oleh pengguna yang memenuhi aturan visibilitas. Koordinat presisi tidak disimpan.',
      actions: [
        { label: 'BATAL', kind: 'btn-ghost' },
        { label: 'LANJUT', kind: 'btn', onClick: detectAndShow },
      ],
    });
    return;
  }
  try {
    const { user } = await api('/me', { method: 'PATCH', body: { visibility: true } });
    state.me = user;
    state.ui.setMe(user);
    state.map.setMe(user);
    // Saling visibilitas: titik teman online kembali + semua user lain di peta global.
    syncFriendMarkers();
    refreshPresence();
    if (state.regionCtx && state.ui.panel.dataset.view === 'region' && !state.ui.panel.classList.contains('hidden')) {
      openRegion({ ...state.regionCtx.region, kind: state.regionCtx.regionKind });
    }
    toast(`Lokasi tampil sebagai: ${user.region?.name ?? '-'}`);
  } catch (err) {
    toast(err.message, true);
  }
}

// Jalur pertama kali: minta lokasi perangkat, simpan wilayah, tampilkan diri.
async function detectAndShow() {
  state.ui.setLocStatus('MENDETEKSI LOKASI...');
  try {
    await updateRegionFromDevice();
    const { user } = await api('/me', { method: 'PATCH', body: { visibility: true } });
    state.me = user;
    state.ui.setMe(user);
    state.map.setMe(user);
    syncFriendMarkers();
    refreshPresence();
    toast(`Lokasi tampil sebagai: ${user.region?.name ?? '-'}`);
  } catch (err) {
    state.ui.setSwitch(false);
    errLokasi(err);
  } finally {
    state.ui.setLocStatus(null);
  }
}

/* ---------- keluar ---------- */

async function handleLogout() {
  try {
    await api('/logout', { method: 'POST' }); // server menghapus sesi + cookie
  } catch {
    // Sesi mungkin sudah mati — tetap keluar.
  }
  showAuth();
}

/* ---------- boot ---------- */

window.addEventListener('tp:unauthorized', () => {
  if (state.me) {
    state.me = null;
    showAuth();
  }
});

// Coba lanjutkan sesi lewat cookie; 401 berarti belum/batas masuk.
api('/me')
  .then(({ user }) => enterApp(user))
  .catch(() => showAuth());

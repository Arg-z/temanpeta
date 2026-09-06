// Panel chat 1-on-1: riwayat, kirim, typing, pesan real-time dari WS.
import { api } from './api.js';
import { el, toast } from './ui.js';

const jam = (iso) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export function createChat(root, { onTyping, onOpenProfile, onSeen }) {
  let partner = null;
  let oldestId = null;
  let typingHideTimer = null;
  let typingSentAt = 0;

  root.classList.add('hidden');

  const headTitle = el('div', { class: 'n' });
  const headId = el('div', { class: 'id' });
  const btnProfile = el('button', { class: 'btn btn-ghost', text: 'PROFIL' });
  btnProfile.addEventListener('click', () => partner && onOpenProfile(partner.publicId));
  const btnClose = el('button', { class: 'close-x', text: 'X', 'aria-label': 'Tutup chat' });
  btnClose.addEventListener('click', close);

  const msgs = el('div', { class: 'chat-msgs' });
  const typingLine = el('div', { class: 'chat-typing' });
  const input = el('input', {
    placeholder: 'Tulis pesan...',
    maxlength: '2000',
    autocomplete: 'off',
    'aria-label': 'Tulis pesan',
  });
  const form = el('form', { class: 'chat-input' }, input, el('button', { class: 'btn', text: 'KIRIM' }));

  const btnMore = el('button', { class: 'chat-more', text: 'MUAT LAGI' });
  btnMore.addEventListener('click', loadOlder);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !partner) return;
    input.value = '';
    try {
      const res = await api('/messages', { method: 'POST', body: { to: partner.publicId, body } });
      append({ id: res.id, body, createdAt: res.createdAt, mine: true });
    } catch (err) {
      input.value = body;
      toast(err.message, true);
    }
  });

  input.addEventListener('input', () => {
    if (!partner) return;
    const now = Date.now();
    if (now - typingSentAt > 2000) {
      typingSentAt = now;
      onTyping(partner.publicId);
    }
  });

  root.append(
    el(
      'div',
      { class: 'chat-head' },
      el('div', { class: 'chat-head-main' }, headTitle, headId),
      btnProfile,
      btnClose,
    ),
    msgs,
    typingLine,
    form,
  );

  function scrollBottom() {
    msgs.scrollTop = msgs.scrollHeight;
  }

  function msgNode(m) {
    return el(
      'div',
      { class: `msg${m.mine ? ' mine' : ''}` },
      m.body,
      el('span', { class: 't', text: jam(m.createdAt) }),
    );
  }

  async function open(user) {
    partner = user;
    root.classList.remove('hidden');
    headTitle.textContent = user.nickname;
    headId.textContent = user.publicId;
    msgs.replaceChildren();
    oldestId = null;
    btnMore.remove();
    typingLine.textContent = '';
    let lastId = null;
    try {
      const { messages } = await api(`/messages/${user.publicId}`);
      if (messages.length > 0) {
        oldestId = messages[0].id;
        lastId = messages[messages.length - 1].id;
        if (messages.length >= 50) msgs.append(btnMore);
        for (const m of messages) msgs.append(msgNode(m));
      } else {
        msgs.append(el('div', { class: 'empty', text: 'Belum ada pesan. Sapa dia!' }));
      }
      // Chat dibuka = semua pesan sampai id terakhir dianggap terbaca.
      onSeen?.(user.publicId, lastId);
      scrollBottom();
      input.focus();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function loadOlder() {
    if (!partner || oldestId == null) return;
    try {
      const { messages } = await api(`/messages/${partner.publicId}?before=${oldestId}`);
      if (messages.length < 50) btnMore.remove();
      if (messages.length > 0) {
        oldestId = messages[0].id;
        const prevHeight = msgs.scrollHeight;
        for (const m of messages.reverse()) msgs.prepend(msgNode(m));
        msgs.scrollTop += msgs.scrollHeight - prevHeight;
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  function close() {
    partner = null;
    root.classList.add('hidden');
  }

  function isActive(publicId) {
    return partner?.publicId === publicId && !root.classList.contains('hidden');
  }

  // Pesan real-time dari teman (mine selalu false — pesan sendiri lewat REST).
  function append(m) {
    const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    msgs.querySelector('.empty')?.remove();
    msgs.append(msgNode(m));
    if (partner) onSeen?.(partner.publicId, m.id); // pesan tampil = terbaca
    if (m.mine || nearBottom) scrollBottom();
  }

  function showTyping() {
    typingLine.textContent = `${partner?.nickname ?? ''} sedang mengetik...`;
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(() => {
      typingLine.textContent = '';
    }, 2500);
  }

  return { open, close, isActive, append, showTyping };
}

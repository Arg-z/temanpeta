// Klien WebSocket dengan sambung-ulang otomatis (jeda eksponensial).
// Autentikasi memakai cookie sesi HttpOnly yang terkirim otomatis
// pada handshake same-origin — tidak ada token di URL.
export function createSocket({ onEvent, onOpen }) {
  let ws = null;
  let retry = 0;
  let closed = false;
  let retryTimer = null;

  function open() {
    if (closed) return;
    retryTimer = null;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      onOpen?.();
    };
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        // Pesan rusak — abaikan.
      }
    };
    ws.onclose = (e) => {
      if (closed) return;
      if (e.code === 4001) {
        // Ditolak server (sesi mati / akun diblokir admin) — paksa keluar.
        window.dispatchEvent(new CustomEvent('tp:unauthorized'));
        return;
      }
      retryTimer = setTimeout(open, Math.min(1000 * 2 ** retry++, 15_000));
    };
  }

  open();

  return {
    send(obj) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      retryTimer = null;
      ws?.close();
    },
  };
}

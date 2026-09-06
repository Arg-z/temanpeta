// Pembungkus fetch untuk REST API server TemanPeta.
// Sesi memakai cookie HttpOnly (tp_session) — tidak ada token di localStorage
// dan tidak ada token yang terekspos ke JavaScript.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Jaringan putus / server tidak merespons — bukan sesi habis.
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internetmu.', 0);
  }
  const json = res.status === 204 ? null : await res.json().catch(() => ({}));
  // 401 dari /login & /register bukan sesi habis — teruskan pesan server apa adanya.
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/register')) {
    window.dispatchEvent(new CustomEvent('tp:unauthorized'));
    throw new ApiError(json?.error ?? 'Sesi berakhir, silakan masuk lagi.', 401);
  }
  if (!res.ok) throw new ApiError(json?.error ?? 'Terjadi kesalahan.', res.status);
  return json;
}

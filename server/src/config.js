const env = (name, fallback) => process.env[name] ?? fallback;

export const config = {
  port: Number(env('PORT', 3000)),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@localhost:54329/temanpeta'),
  tokenTtlDays: Number(env('TOKEN_TTL_DAYS', 30)),
  // Batas jarak (km) untuk melengkapi koordinat ke kabupaten/kota terdekat;
  // di luar itu baru jatuh ke provinsi terdekat.
  snapMaxCityKm: Number(env('SNAP_MAX_CITY_KM', 60)),
  // Notifikasi email laporan — opsional. Kosong = fitur mati.
  // Identitas penerima hanya hidup di .env, tidak pernah tampil di aplikasi.
  smtpHost: env('SMTP_HOST', ''),
  smtpPort: Number(env('SMTP_PORT', 587)),
  smtpUser: env('SMTP_USER', ''),
  smtpPass: env('SMTP_PASS', ''),
  mailFrom: env('MAIL_FROM', ''),
  reportEmailTo: env('REPORT_EMAIL_TO', ''),
};

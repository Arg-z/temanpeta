// Notifikasi email untuk laporan pengguna.
// Aktif hanya bila SMTP_HOST dan REPORT_EMAIL_TO diisi di .env — kalau tidak,
// laporan tetap tersimpan di database tanpa email. Alamat penerima tidak pernah
// dikirim ke klien maupun tampil di aplikasi; email murni outbound.
import nodemailer from 'nodemailer';
import { config } from './config.js';

const transporter = config.smtpHost
  ? nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    })
  : null;

export function mailerActive() {
  return Boolean(transporter && config.reportEmailTo);
}

export async function notifyReportByEmail({ reporter, reported, reason }) {
  if (!mailerActive()) return;
  const waktu = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  await transporter.sendMail({
    from: config.mailFrom || config.smtpUser,
    to: config.reportEmailTo,
    subject: `[TemanPeta] Laporan baru: ${reported.nickname} (${reported.public_id})`,
    text: [
      'Laporan baru masuk di connext.web.id',
      '',
      `Waktu      : ${waktu} WIB`,
      `Pelapor    : ${reporter.nickname} (${reporter.public_id})`,
      `Dilaporkan : ${reported.nickname} (${reported.public_id})`,
      `Alasan     : ${reason || '(tidak diisi)'}`,
    ].join('\n'),
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';
import { hashToken } from './util.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

// Kunci percakapan/pertemanan dua orang: satu baris dengan (user_low, user_high).
export function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// Sesi legacy (token plaintext, pra-migrasi) di-upgrade ke hash saat boot.
// Prefix 'sha256$' membedakan baris baru dari token plaintext, sehingga
// proses ini idempoten dan aman dijalankan setiap boot.
async function upgradeLegacySessions() {
  const { rows } = await pool.query("SELECT token FROM sessions WHERE token NOT LIKE 'sha256$%'");
  for (const row of rows) {
    try {
      await pool.query('UPDATE sessions SET token = $1 WHERE token = $2', [
        hashToken(row.token),
        row.token,
      ]);
    } catch (err) {
      console.error('Gagal upgrade sesi legacy:', err.message);
    }
  }
}

export async function initSchema() {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await upgradeLegacySessions();
}

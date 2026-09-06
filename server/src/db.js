import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

// Kunci percakapan/pertemanan dua orang: satu baris dengan (user_low, user_high).
export function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export async function initSchema() {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}

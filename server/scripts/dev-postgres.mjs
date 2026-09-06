// PostgreSQL lokal khusus development, tanpa Docker dan tanpa sudo.
// Binari server PostgreSQL diunduh otomatis oleh paket embedded-postgres.
//
// Pemakaian: npm run pg   (di folder server/)
// Koneksi:   postgres://postgres:postgres@localhost:54329/temanpeta

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.pgdata',
);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 54329,
  persistent: true,
});

async function main() {
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log('Menyiapkan cluster PostgreSQL baru...');
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('temanpeta');
    console.log('Database "temanpeta" dibuat.');
  } catch {
    // Sudah ada — tidak masalah.
  }
  console.log('PostgreSQL dev jalan di localhost:54329 (Ctrl+C untuk berhenti).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
});

import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { bad } from './util.js';
import { initSchema } from './db.js';
import { initWs } from './ws.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import friendRoutes from './routes/friends.js';
import chatRoutes from './routes/chat.js';
import safetyRoutes from './routes/safety.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
// Dua proxy tetap di depan: nginx (host) → Caddy (container). Hitungan hop
// eksplisit — BUKAN true, agar req.ip tidak bisa dipalsukan lewat XFF
// yang dikirim penyerang (CWE-348).
app.set('trust proxy', 2);
app.use(express.json({ limit: '100kb' }));

// API tidak boleh di-cache browser/proxy mana pun.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CSRF defense-in-depth: permintaan pencatat (POST/PATCH/DELETE) yang membawa
// header Origin wajib berasal dari origin yang sama.
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) {
        return bad(res, 403, 'Origin tidak diizinkan.');
      }
    } catch {
      return bad(res, 403, 'Origin tidak diizinkan.');
    }
  }
  return next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', friendRoutes);
app.use('/api', chatRoutes);
app.use('/api', safetyRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body JSON tidak valid.' });
  }
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Kesalahan server.' });
});

const server = http.createServer(app);
initWs(server);

// Defense-in-depth: rejection yang lolos dari jalur async yang belum
// ter-guard tidak boleh menjatuhkan proses (CWE-248). Tetap dicatat keras.
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});

initSchema()
  .then(() => {
    server.listen(config.port, () => {
      console.log(`TemanPeta server siap di port ${config.port}`);
    });
  })
  .catch((err) => {
    console.error('Gagal menyiapkan database:', err);
    process.exit(1);
  });

// Diekspor untuk test konfigurasi (mis. memastikan trust proxy bukan true).
export default app;

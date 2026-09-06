-- Skema TemanPeta. Dijalankan otomatis saat server boot (idempoten, PostgreSQL 13+).

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id      TEXT UNIQUE NOT NULL,            -- dipilih sendiri pengguna, privat
  password_hash TEXT NOT NULL,                   -- scrypt$<salt>$<hash>
  public_id     CHAR(8) UNIQUE NOT NULL,         -- dibuat server, untuk pencarian & tampilan
  nickname      TEXT NOT NULL,
  region_code   TEXT,                            -- kode kabupaten/kota (bisa kode provinsi hasil fallback)
  visibility    BOOLEAN NOT NULL DEFAULT FALSE,  -- default mati
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_user  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_user, to_user)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests (to_user);

-- Satu baris per pertemanan, user_low/user_high agar urutan konsisten.
CREATE TABLE IF NOT EXISTS friendships (
  user_low   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_low   UUID NOT NULL,
  user_high  UUID NOT NULL,
  sender_id  UUID NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (user_low, user_high, id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked)
);

CREATE TABLE IF NOT EXISTS reports (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migrasi idempoten: panel admin & status ban.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;

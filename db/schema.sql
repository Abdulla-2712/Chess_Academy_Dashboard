-- Chess Trainer Group Management System — Schema

CREATE TABLE IF NOT EXISTS coaches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  level_number INTEGER UNIQUE NOT NULL CHECK (level_number BETWEEN 1 AND 13),
  price_per_session DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  level_id INTEGER NOT NULL REFERENCES levels(id),
  name VARCHAR(100),
  whatsapp_link VARCHAR(500),
  start_date DATE NOT NULL,
  day_of_week VARCHAR(10) NOT NULL,
  time_slot TIME NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL CHECK (session_number BETWEEN 1 AND 8),
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  status VARCHAR(30) DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'excused_absence', 'excused_delayed', 'no_show', 'substitute_taken', 'substitute_given')),
  substitute_coach_id INTEGER REFERENCES coaches(id),
  notes TEXT,
  is_rescheduled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, session_number)
);

CREATE TABLE IF NOT EXISTS earnings (
  id SERIAL PRIMARY KEY,
  coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  earn_type VARCHAR(30) NOT NULL CHECK (earn_type IN ('own_group', 'substitute_taken', 'no_show_penalty')),
  payout_date DATE NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_date ON sessions(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id);
CREATE INDEX IF NOT EXISTS idx_groups_coach_id ON groups(coach_id);
CREATE INDEX IF NOT EXISTS idx_earnings_coach_id ON earnings(coach_id);
CREATE INDEX IF NOT EXISTS idx_earnings_payout_date ON earnings(payout_date);
CREATE INDEX IF NOT EXISTS idx_holidays_coach_id ON holidays(coach_id);

CREATE TABLE IF NOT EXISTS session_messages (
  id SERIAL PRIMARY KEY,
  coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL CHECK (session_number BETWEEN 1 AND 8),
  title VARCHAR(255),
  message_text TEXT NOT NULL,
  image_path VARCHAR(500),
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_messages_level_session ON session_messages(level_id, session_number);
CREATE INDEX IF NOT EXISTS idx_session_messages_coach_id ON session_messages(coach_id);

-- ===== Non-destructive schema updates (for existing DBs) =====
ALTER TABLE groups ADD COLUMN IF NOT EXISTS whatsapp_link VARCHAR(500);

-- Some older DBs were created without 'excused_delayed' in the sessions status CHECK.
-- Keep the constraint name used by Postgres defaults in this project.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_status_check
  CHECK (
    status IN (
      'pending',
      'confirmed',
      'excused_absence',
      'excused_delayed',
      'no_show',
      'substitute_taken',
      'substitute_given'
    )
  );

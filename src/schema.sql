PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('docente', 'direccion', 'apoderado')),
  full_name     TEXT    NOT NULL,
  title         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
  code       TEXT PRIMARY KEY,
  position   INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS competencies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,
  description TEXT    NOT NULL,
  UNIQUE (course_id, code)
);

CREATE TABLE IF NOT EXISTS sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  grade      TEXT    NOT NULL,
  school_year INTEGER NOT NULL,
  tutor_id   INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS teaching_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  course_id  INTEGER NOT NULL REFERENCES courses(id),
  section_id INTEGER NOT NULL REFERENCES sections(id),
  UNIQUE (teacher_id, course_id, section_id)
);

CREATE TABLE IF NOT EXISTS students (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dni          TEXT    NOT NULL UNIQUE,
  last_names   TEXT    NOT NULL,
  first_names  TEXT    NOT NULL,
  section_id   INTEGER NOT NULL REFERENCES sections(id),
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id, active);

CREATE TABLE IF NOT EXISTS guardians (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL UNIQUE REFERENCES users(id),
  student_id          INTEGER NOT NULL UNIQUE REFERENCES students(id),
  full_name           TEXT    NOT NULL,
  phone               TEXT,
  relationship        TEXT,
  consent_accepted_at TEXT,
  notifications_enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id),
  section_id   INTEGER NOT NULL REFERENCES sections(id),
  date         TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('A', 'T', 'FJ', 'FI')),
  arrival_time TEXT,
  recorded_by  INTEGER REFERENCES users(id),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_section_date ON attendance(section_id, date);

CREATE TABLE IF NOT EXISTS grades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  course_id   INTEGER NOT NULL REFERENCES courses(id),
  term        TEXT    NOT NULL REFERENCES terms(code),
  c1          INTEGER CHECK (c1 BETWEEN 0 AND 20),
  c2          INTEGER CHECK (c2 BETWEEN 0 AND 20),
  c3          INTEGER CHECK (c3 BETWEEN 0 AND 20),
  c4          INTEGER CHECK (c4 BETWEEN 0 AND 20),
  status      TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (student_id, course_id, term)
);
CREATE INDEX IF NOT EXISTS idx_grades_course_term ON grades(course_id, term);

CREATE TABLE IF NOT EXISTS conduct_incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  section_id  INTEGER NOT NULL REFERENCES sections(id),
  date        TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK (type IN ('leve', 'moderada', 'grave')),
  description TEXT    NOT NULL,
  recorded_by INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  notified_at TEXT,
  notified_guardian TEXT
);
CREATE INDEX IF NOT EXISTS idx_conduct_section_date ON conduct_incidents(section_id, date);

CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER NOT NULL UNIQUE REFERENCES guardians(id),
  teacher_id  INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id),
  kind            TEXT    NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  body            TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  read_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id  INTEGER NOT NULL REFERENCES guardians(id),
  kind         TEXT    NOT NULL CHECK (kind IN ('asistencia', 'conducta', 'notas', 'mensaje', 'comunicado')),
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  delivered_at TEXT,
  read_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_guardian ON notifications(guardian_id, created_at);

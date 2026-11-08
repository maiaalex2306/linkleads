/** Schema base (versão 1). Mudanças novas vão em MIGRATIONS (index.ts). */
export const SCHEMA_SQL = `-- LinkLeads — banco local por conta (um arquivo linkleads.db por partição de conta)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

-- Pessoas ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
  id            TEXT PRIMARY KEY,
  public_id     TEXT UNIQUE,          -- slug da URL pública
  member_id     TEXT UNIQUE,          -- id interno (URN) quando conhecido
  first_name    TEXT,
  last_name     TEXT,
  headline      TEXT,
  avatar        TEXT,
  location      TEXT,
  company       TEXT,
  position      TEXT,
  connection_degree INTEGER,
  custom_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  company TEXT, title TEXT, start_date TEXT, end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS person_education (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  school TEXT, degree TEXT, field TEXT, start_date TEXT, end_date TEXT
);
CREATE TABLE IF NOT EXISTS person_skills (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  PRIMARY KEY (person_id, skill_name)
);
CREATE TABLE IF NOT EXISTS person_contacts (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone','website','social')),
  value TEXT NOT NULL,
  source TEXT,                         -- profile | enrichment | import
  PRIMARY KEY (person_id, kind, value)
);

-- Coleções (listas nomeadas) ------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT,                         -- search | csv | post | event | group | company
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collection_people (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, person_id)
);

-- Campanhas -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaign_actions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cool_down_ms INTEGER NOT NULL DEFAULT 60000,
  max_results INTEGER NOT NULL DEFAULT -1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  last_run_at INTEGER,
  UNIQUE (campaign_id, position)
);
CREATE TABLE IF NOT EXISTS campaign_action_people (
  campaign_id TEXT NOT NULL,
  action_id TEXT NOT NULL REFERENCES campaign_actions(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','processed','successful','failed')),
  reason TEXT,
  seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (action_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_cap_queue ON campaign_action_people (action_id, status, seq);

-- Bloqueio global (respondeu / pediu para parar / blacklist) ----------------
CREATE TABLE IF NOT EXISTS person_blocks (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mensagens e inbox ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  thread_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  ai_label TEXT                         -- interessado | objecao | agora_nao | indicou_outro | opt_out
);
CREATE INDEX IF NOT EXISTS idx_messages_person ON messages (person_id, sent_at);

-- Orçamento diário consumido -------------------------------------------------
CREATE TABLE IF NOT EXISTS action_usage (
  day TEXT NOT NULL,                    -- YYYY-MM-DD (fuso da conta)
  budget_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, budget_key)
);

-- Log de execução (auditoria) e outbox de sincronização ----------------------
CREATE TABLE IF NOT EXISTS action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT, action_id TEXT, person_id TEXT,
  status TEXT NOT NULL, reason TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                   -- webhook | crm | cloud_sync
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

-- Posts lidos (curtidos/comentados) ------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  url TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  posted_at TEXT,
  has_media INTEGER NOT NULL DEFAULT 0,
  liked_at TEXT,
  commented_at TEXT,
  comment TEXT,
  interpretation_json TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_person ON posts (person_id, seen_at);

-- Comentários gerados pela IA aguardando aprovação ---------------------------
CREATE TABLE IF NOT EXISTS comment_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  post_url TEXT NOT NULL,
  comment TEXT NOT NULL,
  interpretation_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','posted','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  UNIQUE (action_id, person_id)
);
`;

use tauri_plugin_sql::{Migration, MigrationKind};

/// All database migrations, in order. Applied automatically on startup by
/// tauri-plugin-sql. IDs are TEXT (UUID from crypto.randomUUID() on the JS
/// side), timestamps are TEXT ISO-8601.
pub fn all_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: MIGRATION_001,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "embeddings for semantic memory retrieval",
            sql: MIGRATION_002,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "embeddings: allow lore kind and global (chat-less) rows",
            sql: MIGRATION_003,
            kind: MigrationKind::Up,
        },
    ]
}

const MIGRATION_001: &str = r#"
CREATE TABLE connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai','gemini','claude')),
  base_url TEXT,
  model TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.8, top_p REAL NOT NULL DEFAULT 0.95,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  context_budget INTEGER NOT NULL DEFAULT 8000,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '', first_mes TEXT NOT NULL DEFAULT '',
  mes_example TEXT NOT NULL DEFAULT '',
  alternate_greetings TEXT NOT NULL DEFAULT '[]',
  system_prompt TEXT NOT NULL DEFAULT '',
  post_history_instructions TEXT NOT NULL DEFAULT '',
  creator_notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  avatar_path TEXT,
  card_json TEXT,
  spec_version TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE personas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', avatar_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
  character_id TEXT NOT NULL REFERENCES characters(id),
  persona_id TEXT REFERENCES personas(id),
  connection_id TEXT REFERENCES connections(id),
  extraction_connection_id TEXT REFERENCES connections(id),
  last_extracted_message_id TEXT,
  last_summarized_message_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  swipes TEXT NOT NULL DEFAULT '[]',
  active_swipe INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE lorebooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE lore_entries (
  id TEXT PRIMARY KEY, lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  keys TEXT NOT NULL DEFAULT '[]', secondary_keys TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  always_on INTEGER NOT NULL DEFAULT 0, case_sensitive INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX idx_lore_entries_book ON lore_entries(lorebook_id);
CREATE TABLE lorebook_links (
  id TEXT PRIMARY KEY, lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('character','chat','global')),
  target_id TEXT
);

CREATE TABLE ledger_facts (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('player','world','npc','event','quest')),
  subject TEXT NOT NULL, fact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (chat_id, category, subject)
);

CREATE TABLE summaries (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id) ON DELETE CASCADE,
  up_to_message_id TEXT NOT NULL, text TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"#;

/// Vectors are stored as base64-encoded little-endian f32 arrays (TEXT) —
/// compact enough for this scale and readable from the JS side without a
/// SQLite extension. `kind` is future-proofed for message/summary chunks
/// (next milestone); only 'fact' rows exist today.
const MIGRATION_002: &str = r#"
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact','summary','message')),
  ref_id TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE INDEX idx_embeddings_chat ON embeddings(chat_id, kind);
"#;

/// Lorebook entries aren't chat-scoped, so their embeddings need a NULL
/// chat_id — SQLite can't relax NOT NULL/CHECK in place, hence the
/// rebuild-and-rename dance.
const MIGRATION_003: &str = r#"
CREATE TABLE embeddings_new (
  id TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact','summary','message','lore')),
  ref_id TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (kind, ref_id)
);
INSERT INTO embeddings_new SELECT * FROM embeddings;
DROP TABLE embeddings;
ALTER TABLE embeddings_new RENAME TO embeddings;
CREATE INDEX idx_embeddings_chat ON embeddings(chat_id, kind);
"#;

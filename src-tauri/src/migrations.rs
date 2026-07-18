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
        Migration {
            version: 4,
            description: "group chats: chat_members, message authorship, auto-reply flag",
            sql: MIGRATION_004,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "usage_log for token/request statistics",
            sql: MIGRATION_005,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "ledger_facts sub_key for multi-fact subjects",
            sql: MIGRATION_006,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "personas: structured fields (gender, age, race, appearance, skills, inventory)",
            sql: MIGRATION_007,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "ledger_facts: image_path for auto-generated illustrations",
            sql: MIGRATION_008,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "connections: purpose column (chat, image, embedding)",
            sql: MIGRATION_009,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "connections: multi-purpose JSON array replaces single-purpose column",
            sql: MIGRATION_010,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "personas: progression column (skill, level, none) plus xp/level tracking",
            sql: MIGRATION_011,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "quest journal: AI-managed quest tracking table",
            sql: MIGRATION_012,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "personas: conditions column",
            sql: MIGRATION_013,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "factions: faction_reputations table",
            sql: MIGRATION_014,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "crafting: crafting_recipes table",
            sql: MIGRATION_015,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "chronicle export: export_jobs table for premium book export",
            sql: MIGRATION_016,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "tts: per-character voice mapping",
            sql: MIGRATION_017,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "presets: named prompt presets + per-chat assignment",
            sql: MIGRATION_018,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "auto-canon: soft canon flag + stability tracking on ledger facts",
            sql: MIGRATION_019,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "tts: voice profiles with pitch/rate/volume per profile",
            sql: MIGRATION_020,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "presets: add top_k and min_p sampler params",
            sql: MIGRATION_021,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "presets: add author_note for hloubková injekce",
            sql: MIGRATION_022,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "presets: add regex_rules for find/replace output transform",
            sql: MIGRATION_023,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "chats: add game_language for per-chat AI output language",
            sql: MIGRATION_024,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "lore_entries: recursive activation, selective AND/NOT, timed effects, vector activation",
            sql: MIGRATION_025,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "chats: add inventory — live gameplay inventory scoped to the chat/campaign instead of the persona",
            sql: MIGRATION_026,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "chats: add skills, conditions, xp, level — live gameplay progression scoped to the chat/campaign instead of the persona",
            sql: MIGRATION_027,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "chats: add modifications — body modifications tracked via [MOD:...] tags, always campaign-specific (no persona template)",
            sql: MIGRATION_028,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "calendar_events: world calendar events for the fantasy calendar system",
            sql: MIGRATION_029,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "chats: add hardcore_mode — real, permanent character death (opt-in per chat)",
            sql: MIGRATION_030,
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

/// Group chats (M10): `chat_members` tracks the roster (`chats.character_id`
/// stays the primary member, invariant enforced in the repo layer, not SQL);
/// `messages.character_id` is a soft ref (no FK — messages can outlive a
/// removed member) recording who authored an assistant line; `auto_reply`
/// toggles automatic speaker selection. Backfill gives every existing chat a
/// single member and attributes its assistant messages to that character, so
/// solo chats keep working unchanged.
const MIGRATION_004: &str = r#"
CREATE TABLE chat_members (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (chat_id, character_id)
);
CREATE INDEX idx_chat_members_chat ON chat_members(chat_id, position);
ALTER TABLE messages ADD COLUMN character_id TEXT;
ALTER TABLE chats ADD COLUMN auto_reply INTEGER NOT NULL DEFAULT 0;
INSERT INTO chat_members (id, chat_id, character_id, position, created_at)
SELECT lower(hex(randomblob(16))), id, character_id, 0, created_at FROM chats;
UPDATE messages SET character_id =
  (SELECT character_id FROM chats WHERE chats.id = messages.chat_id)
WHERE role = 'assistant';
"#;

/// Per-request token/usage estimates (M12 §3) — lets the stats panel show
/// today's/week's/month's request count (the number that matters for free
/// tier RPD limits) and rough token totals. `connection_id` has no FK: a
/// deleted connection shouldn't cascade-delete usage history.
const MIGRATION_005: &str = r#"
CREATE TABLE usage_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat','suggest','memory','embedding')),
  connection_id TEXT,
  input_tokens_est INTEGER NOT NULL,
  output_tokens_est INTEGER NOT NULL
);
CREATE INDEX idx_usage_log_created ON usage_log(created_at);
"#;

/// Adds `sub_key TEXT NOT NULL DEFAULT ''` to `ledger_facts` and widens the
/// UNIQUE constraint to `(chat_id, category, subject, sub_key)` so multiple
/// facts can coexist for the same (category, subject) pair — e.g. a player
/// ("Hráč") who has both a sword ("má meč") and a shield ("má štít").
/// Rebuilds the table because SQLite doesn't support ALTER TABLE DROP
/// CONSTRAINT natively (same pattern as migration 3).
const MIGRATION_006: &str = r#"
CREATE TABLE ledger_facts_new (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('player','world','npc','event','quest')),
  subject TEXT NOT NULL, sub_key TEXT NOT NULL DEFAULT '', fact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (chat_id, category, subject, sub_key)
);
INSERT INTO ledger_facts_new SELECT id, chat_id, category, subject, '', fact, status, locked, created_at, updated_at FROM ledger_facts;
DROP TABLE ledger_facts;
ALTER TABLE ledger_facts_new RENAME TO ledger_facts;
"#;

/// Personas get structured fields so the app (and AI) can work with discrete
/// attributes instead of a single free-text description. `skills` and
/// `inventory` are JSON TEXT arrays — the repo layer handles serialisation.
const MIGRATION_007: &str = r#"
ALTER TABLE personas ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE personas ADD COLUMN age INTEGER;
ALTER TABLE personas ADD COLUMN race TEXT NOT NULL DEFAULT '';
ALTER TABLE personas ADD COLUMN appearance TEXT NOT NULL DEFAULT '';
ALTER TABLE personas ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
ALTER TABLE personas ADD COLUMN inventory TEXT NOT NULL DEFAULT '[]';
"#;

/// Optional illustration path for locked ledger facts — populated by the
/// background image generator so the memory panel can show a visual
/// alongside each fact's text.
const MIGRATION_008: &str = r#"
ALTER TABLE ledger_facts ADD COLUMN image_path TEXT;
"#;

/// V1: single-purpose column. Superseded by v10 (multi-purpose JSON array).
const MIGRATION_009: &str = r#"
ALTER TABLE connections ADD COLUMN purpose TEXT NOT NULL DEFAULT 'chat';
"#;

/// V2: replaces the single `purpose` column with a JSON array `purposes`
/// so one connection can serve multiple purposes (e.g. chat + image).
const MIGRATION_010: &str = r#"
ALTER TABLE connections ADD COLUMN purposes TEXT NOT NULL DEFAULT '["chat","image","embedding"]';
UPDATE connections SET purposes = json_array(purpose);
"#;

/// Adds progression system: `progression` picks the tag-based game mechanic
/// (`skill`, `level`, or `none`), while `xp` and `level` track numeric
/// level-based progression separately from the JSON `skills` array.
const MIGRATION_011: &str = r#"
ALTER TABLE personas ADD COLUMN progression TEXT NOT NULL DEFAULT 'skill';
ALTER TABLE personas ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE personas ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
"#;

/// Quest journal (M17): AI-managed quest tracking through game tags.
/// Quests are chat-scoped and managed via `[QUEST:…]` tags in AI responses.
const MIGRATION_012: &str = r#"
CREATE TABLE quests (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);
CREATE INDEX idx_quests_chat ON quests(chat_id, status);
"#;

const MIGRATION_013: &str = r#"ALTER TABLE personas ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]';"#;
const MIGRATION_014: &str = r#"CREATE TABLE IF NOT EXISTS faction_reputations (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL, faction_name TEXT NOT NULL, reputation INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (persona_id) REFERENCES personas(id));"#;

const MIGRATION_015: &str = r#"
CREATE TABLE crafting_recipes (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  result_item TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  skill_name TEXT,
  tier INTEGER NOT NULL DEFAULT 0,
  perks TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  crafted_at TEXT,
  FOREIGN KEY (persona_id) REFERENCES personas(id)
);
CREATE INDEX idx_crafting_recipes_persona ON crafting_recipes(persona_id);
"#;

const MIGRATION_016: &str = r#"
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  persona_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  progress INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  current_chunk INTEGER NOT NULL DEFAULT 0,
  connection_id TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'fantasy',
  format TEXT NOT NULL DEFAULT 'html',
  include_illustrations INTEGER NOT NULL DEFAULT 1,
  chunks_json TEXT NOT NULL DEFAULT '[]',
  output_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;

const MIGRATION_017: &str = r#"ALTER TABLE characters ADD COLUMN tts_voice TEXT;"#;

const MIGRATION_018: &str = r#"
CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  extra_system_prompt TEXT NOT NULL DEFAULT '',
  temperature REAL,
  top_p REAL,
  frequency_penalty REAL,
  presence_penalty REAL,
  max_tokens INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE chats ADD COLUMN preset_id TEXT;
"#;

const MIGRATION_019: &str = r#"
ALTER TABLE ledger_facts ADD COLUMN canon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_facts ADD COLUMN stability INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_facts ADD COLUMN contradiction_streak INTEGER NOT NULL DEFAULT 0;
"#;

const MIGRATION_021: &str = r#"
ALTER TABLE presets ADD COLUMN top_k REAL;
ALTER TABLE presets ADD COLUMN min_p REAL;
"#;

const MIGRATION_022: &str = r#"ALTER TABLE presets ADD COLUMN author_note TEXT NOT NULL DEFAULT '';"#;

const MIGRATION_023: &str = r#"ALTER TABLE presets ADD COLUMN regex_rules TEXT NOT NULL DEFAULT '[]';"#;

const MIGRATION_024: &str = r#"ALTER TABLE chats ADD COLUMN game_language TEXT NOT NULL DEFAULT 'cs';"#;

const MIGRATION_025: &str = r#"
ALTER TABLE lore_entries ADD COLUMN recursive_activation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lore_entries ADD COLUMN activation_depth INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lore_entries ADD COLUMN selective_keys TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lore_entries ADD COLUMN timed_json TEXT;
ALTER TABLE lore_entries ADD COLUMN vector_threshold REAL;
ALTER TABLE lore_entries ADD COLUMN vector_budget INTEGER NOT NULL DEFAULT 2;
"#;

const MIGRATION_026: &str = r#"ALTER TABLE chats ADD COLUMN inventory TEXT NOT NULL DEFAULT '[]';"#;

/// Same root bug as migration 26, for skills/xp/level/conditions: these lived
/// on `personas` (shared globally across every campaign reusing a persona),
/// so a second campaign would inherit progression from an unrelated one.
/// Moved to the chat, seeded from the persona template at chat-creation time.
const MIGRATION_027: &str = r#"
ALTER TABLE chats ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chats ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chats ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
"#;

/// Body modifications: always campaign-specific, never inherited from a
/// persona template (unlike inventory/skills/conditions above), so this is
/// just a new chat column with no persona-seeding counterpart.
const MIGRATION_028: &str = r#"ALTER TABLE chats ADD COLUMN modifications TEXT NOT NULL DEFAULT '[]';"#;

const MIGRATION_029: &str = r#"
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  month_name TEXT NOT NULL,
  year INTEGER,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

/// Hardcore mode: opt-in per chat (set at creation, toggleable later from the
/// Director popover) — when on, character death is real and permanent (see
/// DIRECTOR_HARDCORE_NOTE / the [GAMEOVER:reason] tag).
const MIGRATION_030: &str = r#"ALTER TABLE chats ADD COLUMN hardcore_mode INTEGER NOT NULL DEFAULT 0;"#;

const MIGRATION_020: &str = r#"
CREATE TABLE tts_voice_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  backend TEXT NOT NULL DEFAULT 'edge-tts',
  voice_id TEXT NOT NULL,
  pitch REAL NOT NULL DEFAULT 0.0,
  rate REAL NOT NULL DEFAULT 1.0,
  volume REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = join(__dirname, "..", "data", "wingman.db");

const DEFAULT_SETTINGS = {
  self_context: "",
  system_guidelines:
    "You are a discreet personal SMS dating coach. Draft natural texts that sound like the user, not like an AI. Keep replies conversational and appropriate for SMS.",
  moonshot_api_key: "",
  llm_base_url: "https://api.openai.com/v1",
  llm_model: "gpt-4o-mini",
  reasoning_effort: "low",
  keep_recent_messages: "24",
  compact_when_over: "40",
};

export function openDb(dbPath = process.env.WINGMAN_DB || DEFAULT_DB) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      memory_summary TEXT NOT NULL DEFAULT '',
      response_delay_seconds INTEGER NOT NULL DEFAULT 0,
      content_length TEXT NOT NULL DEFAULT 'medium',
      tone TEXT NOT NULL DEFAULT 'flirty',
      style TEXT NOT NULL DEFAULT 'casual',
      push_for_date INTEGER NOT NULL DEFAULT 0,
      custom_instructions TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      body TEXT NOT NULL,
      gv_timestamp TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL,
      compacted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(target_id, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS draft_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      trigger_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','dismissed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_set_id INTEGER NOT NULL REFERENCES draft_sets(id) ON DELETE CASCADE,
      style_label TEXT NOT NULL,
      body TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_target ON messages(target_id, id);
    CREATE INDEX IF NOT EXISTS idx_draft_sets_target ON draft_sets(target_id, status);
  `);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, value);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function getSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function setSettings(db, patch) {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, value == null ? "" : String(value));
    }
  });
  tx(Object.entries(patch));
  return getSettings(db);
}

export function messageFingerprint(direction, body, gvTimestamp) {
  const norm = String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${direction}|${gvTimestamp || ""}|${norm}`;
}

import type { SqlMigration } from './MigrationRunner.js';

const SQLITE_LOCAL_TIMESTAMP_EXPRESSION = `STRFTIME('%Y-%m-%dT%H:%M:%f', 'now', 'localtime')`;

export const databaseMigrations: SqlMigration[] = [
  {
    version: '001_core_sessions',
    description: 'Initialize session and memory tables',
    statements: [
      `
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          channel TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          uuid TEXT,
          created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS session_memory (
          session_id INTEGER PRIMARY KEY,
          summary TEXT NOT NULL DEFAULT '',
          summarized_message_count INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS session_agent_state (
          session_id INTEGER PRIMARY KEY,
          agent_name TEXT NOT NULL,
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS memory_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'other',
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          confidence REAL NOT NULL DEFAULT 1,
          confirmations INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          last_seen_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS memory_operations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          entry_id INTEGER,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT,
          before_json TEXT,
          after_json TEXT,
          evidence_json TEXT,
          created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE SET NULL
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          entry_id INTEGER NOT NULL,
          provider_name TEXT NOT NULL,
          model TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          embedding_json TEXT NOT NULL,
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          PRIMARY KEY (entry_id, provider_name, model),
          FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS conversation_memory (
          channel TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          summarized_until_message_id INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          PRIMARY KEY (channel, chat_id)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS channel_resources (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT,
          size INTEGER,
          remote_url TEXT,
          platform_file_id TEXT,
          local_path TEXT,
          sha256 TEXT,
          created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS channel_delivery_jobs (
          job_id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          channel TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          retryable INTEGER NOT NULL DEFAULT 0,
          next_retry_at DATETIME,
          platform_message_id TEXT,
          error_code TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
          updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
        )
      `,
      'CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key)',
      'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_memory_entries_chat ON memory_entries(channel, chat_id, status)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_entries_unique_active ON memory_entries(channel, chat_id, content) WHERE status = \'active\'',
      'CREATE INDEX IF NOT EXISTS idx_memory_operations_chat ON memory_operations(channel, chat_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_memory_embeddings_lookup ON memory_embeddings(provider_name, model, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_channel_resources_message ON channel_resources(channel, conversation_id, message_id)',
      'CREATE INDEX IF NOT EXISTS idx_channel_delivery_jobs_status ON channel_delivery_jobs(status, next_retry_at)'
    ]
  }
];

export const cronMigrations: SqlMigration[] = [
  {
    version: '001_cron_jobs',
    description: 'Initialize cron job table',
    statements: [
      `
        CREATE TABLE IF NOT EXISTS cron_jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          schedule_kind TEXT NOT NULL,
          schedule_data TEXT NOT NULL,
          payload TEXT NOT NULL,
          next_run_at_ms INTEGER,
          last_run_at_ms INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_next_run
        ON cron_jobs(enabled, next_run_at_ms)
        WHERE enabled = 1 AND next_run_at_ms IS NOT NULL
      `
    ]
  }
];

import type { Logger } from '../observability/index.js';

export interface SqlMigration {
  version: string;
  description: string;
  statements: string[];
}

interface MigrationRunnerOptions {
  scope: string;
  log: Logger;
  migrations: SqlMigration[];
  execute: (sql: string, params?: Array<string | number | boolean | null>) => Promise<void>;
  queryAppliedVersions: () => Promise<string[]>;
  transaction?: <T>(operation: () => Promise<T>) => Promise<T>;
}

const SCHEMA_MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    scope TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (scope, version)
  )
`;

export async function runSqlMigrations(options: MigrationRunnerOptions): Promise<void> {
  const runInTransaction = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!options.transaction) {
      return operation();
    }
    return options.transaction(operation);
  };

  await options.execute(SCHEMA_MIGRATIONS_SQL);

  const appliedVersions = new Set(await options.queryAppliedVersions());

  for (const migration of options.migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await runInTransaction(async () => {
      for (const statement of migration.statements) {
        await options.execute(statement);
      }

      await options.execute(
        'INSERT INTO schema_migrations (scope, version, description, applied_at) VALUES (?, ?, ?, ?)',
        [options.scope, migration.version, migration.description, new Date().toISOString()]
      );
    });

    options.log.info('数据库迁移已应用', {
      scope: options.scope,
      version: migration.version,
      description: migration.description
    });
  }
}

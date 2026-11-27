import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type RepoLensDatabase = BetterSQLite3Database;

/** Connection contract for the future local SQLite adapter. No database is opened in v0.1.0. */
export interface DatabaseConnection {
  readonly db: RepoLensDatabase;
  close(): void;
}

/** The Electron main process will supply a user-data path, never an imported repository path. */
export interface DatabaseConnectionFactory {
  open(databasePath: string): DatabaseConnection;
}

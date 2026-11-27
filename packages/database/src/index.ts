export type DatabaseDialect = 'sqlite';

export interface DatabaseConfiguration {
  readonly dialect: DatabaseDialect;
  readonly databaseUrl: string;
}

/** Foundation-only capability boundary; no schema, driver, or persistence operations are implemented. */
export interface DatabaseAdapter {
  readonly dialect: DatabaseDialect;
  connect(configuration: DatabaseConfiguration): Promise<void>;
  close(): Promise<void>;
}

/** Placeholder for the typed Drizzle database instance once persistence is implemented. */
export interface DrizzleDatabaseHandle<TSchema extends Record<string, unknown>> {
  readonly schema: TSchema;
  readonly dialect: DatabaseDialect;
}

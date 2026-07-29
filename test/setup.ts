import schemaSql from '../schema.sql?raw';

const TABLES = ['feedback', 'sent', 'seen', 'backlog_used', 'recipients', 'extra_sent'];

// vitest-pool-workers does not give each test its own D1 storage within a
// file, so this both creates the schema (idempotent, safe on every call)
// and clears all rows, guaranteeing every test starts from an empty database
// regardless of what earlier tests in the same file left behind.
export async function applySchema(db: D1Database): Promise<void> {
  const statements = schemaSql
    .split(';')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
  for (const table of TABLES) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}

import schemaSql from '../schema.sql?raw';

export async function applySchema(db: D1Database): Promise<void> {
  const statements = schemaSql
    .split(';')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

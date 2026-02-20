/**
 * SQLite Adapter - Runtime-agnostic SQLite interface
 * 
 * Supports both:
 * - better-sqlite3 (Node.js) - for Claude Code CLI
 * - bun:sqlite (Bun) - for OpenCode plugins
 */

// Declare Bun types for runtime detection
declare global {
  // eslint-disable-next-line no-var
  var Bun: { version: string } | undefined;
}

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  pragma?(pragma: string): unknown;
}

/**
 * Detect if running in Bun
 */
export function isBun(): boolean {
  return typeof globalThis.Bun !== 'undefined';
}

/**
 * Create a SQLite database connection using the appropriate driver
 */
export async function createDatabase(dbPath: string): Promise<SqliteDatabase> {
  if (isBun()) {
    return createBunDatabase(dbPath);
  } else {
    return createNodeDatabase(dbPath);
  }
}

/**
 * Create database using bun:sqlite
 */
async function createBunDatabase(dbPath: string): Promise<SqliteDatabase> {
  // Dynamic import for bun:sqlite
  // @ts-expect-error - bun:sqlite is only available in Bun runtime
  const { Database } = await import('bun:sqlite');
  const db = new Database(dbPath);
  
  // Wrapper to match our interface
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          // bun:sqlite's run returns the statement, we need to adapt
          const result = stmt.run(...params);
          return {
            changes: (db as any).changes ?? 0,
            lastInsertRowid: (db as any).lastInsertRowid ?? 0,
          };
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
      };
    },
    
    close(): void {
      db.close();
    },
    
    pragma(pragma: string): unknown {
      // bun:sqlite handles pragma via exec or query
      return db.query(`PRAGMA ${pragma}`).get();
    },
  };
}

/**
 * Create database using better-sqlite3
 */
async function createNodeDatabase(dbPath: string): Promise<SqliteDatabase> {
  // Dynamic import for better-sqlite3
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          const result = stmt.run(...params);
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
      };
    },
    
    close(): void {
      db.close();
    },
    
    pragma(pragma: string): unknown {
      return db.pragma(pragma);
    },
  };
}

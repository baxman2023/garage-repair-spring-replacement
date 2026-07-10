import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '@copyforge/core';
import * as schema from './schema/index.js';

/**
 * Shared MariaDB connection pool + Drizzle client.
 *
 * The pool is created lazily on first use so importing this module never
 * opens a connection (keeps `next build` and tooling side-effect free).
 */

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: env.DATABASE_URL,
      connectionLimit: 10,
      waitForConnections: true,
      enableKeepAlive: true,
    });
  }
  return pool;
}

export type Database = MySql2Database<typeof schema>;

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = drizzle(getPool(), { schema, mode: 'default' });
  }
  return db;
}

/** Close the pool. For graceful shutdown / tests. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

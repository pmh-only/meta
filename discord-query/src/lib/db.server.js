import { DuckDBInstance } from '@duckdb/node-api';
import { resolve } from 'path';

const DB_PATH =
  process.env.DISCORD_DB_PATH ||
  resolve(process.cwd(), '../discord-scraper/discord.duckdb');

// Survive HMR reloads in dev by caching on globalThis
const _cache =
  globalThis.__duckdb_cache ??
  (globalThis.__duckdb_cache = { instance: null, conn: null });

async function getConnection() {
  if (!_cache.conn) {
    _cache.instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
    _cache.conn = await _cache.instance.connect();
    console.log(`[DuckDB] Connected to ${DB_PATH}`);
  }
  return _cache.conn;
}

function serializeValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  // DuckDB special types (DuckDBTimestampTZValue, DuckDBTimeValue, etc.)
  // all have a working toString() but are not plain objects
  if (typeof v === 'object' && v.constructor !== Object && !Array.isArray(v)) {
    return v.toString();
  }
  return v;
}

function serializeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, serializeValue(v)])
  );
}

/**
 * Run a SQL string and return { columns: string[], rows: object[] }
 */
export async function queryDb(sql) {
  const conn = await getConnection();
  const result = await conn.runAndReadAll(sql);

  // Get column names from result metadata (works even for 0-row results)
  const columnCount = result.columnCount;
  const columns = Array.from({ length: columnCount }, (_, i) =>
    result.columnName(i)
  );

  const rows = result.getRowObjects().map(serializeRow);
  return { columns, rows };
}

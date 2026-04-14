import { json } from '@sveltejs/kit';
import { queryDb } from '$lib/db.server.js';

export async function GET() {
  try {
    const { rows } = await queryDb(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position
    `);

    // Group columns by table name
    const tables = {};
    for (const row of rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push({ name: row.column_name, type: row.data_type });
    }

    return json(tables);
  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}

import { queryDb } from '$lib/db.server.js';

/** @param {string} _ @param {unknown} v */
function replacer(_, v) {
  if (typeof v === 'bigint') return v.toString();
  if (v !== null && typeof v === 'object' && v.constructor !== Object && !Array.isArray(v)) {
    return v.toString();
  }
  return v;
}

function safeJson(data, status = 200) {
  return new Response(JSON.stringify(data, replacer), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Allow read-only query types only
const ALLOWED = /^\s*(SELECT|WITH|PRAGMA|SHOW|DESCRIBE|EXPLAIN)\b/i;

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return safeJson({ error: 'Invalid JSON body' }, 400);
  }

  const sql = body?.sql?.trim();
  if (!sql) {
    return safeJson({ error: 'No SQL provided' }, 400);
  }

  if (!ALLOWED.test(sql)) {
    return safeJson(
      { error: 'Only SELECT / WITH / PRAGMA / SHOW / DESCRIBE / EXPLAIN queries are allowed' },
      400
    );
  }

  try {
    const result = await queryDb(sql);
    return safeJson(result);
  } catch (err) {
    return safeJson({ error: err.message }, 500);
  }
}

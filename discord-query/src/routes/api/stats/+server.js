import { queryDb } from '$lib/db.server.js';

function replacer(_, v) {
  return typeof v === 'bigint' ? v.toString() : v;
}

export async function GET() {
  try {
    const { rows } = await queryDb(`
      SELECT
        (SELECT COUNT(*)                    FROM messages)              AS messages,
        (SELECT COUNT(DISTINCT author_id)   FROM messages)              AS authors,
        (SELECT COUNT(DISTINCT channel_id)  FROM messages)              AS channels,
        (SELECT COUNT(*)                    FROM reactions)             AS reactions,
        (SELECT COUNT(*)                    FROM attachments)           AS attachments,
        (SELECT COUNT(*)                    FROM embeds)                AS embeds,
        (SELECT MIN(timestamp)              FROM messages)              AS oldest,
        (SELECT MAX(timestamp)              FROM messages)              AS newest
    `);

    return new Response(JSON.stringify(rows[0] ?? {}, replacer), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

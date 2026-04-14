/** @type {{ name: string; description: string; sql: string }[]} */
export default [
  {
    name: 'Recent Messages',
    description: 'Last 50 messages with author names',
    sql: `SELECT
  m.timestamp,
  COALESCE(a.global_name, a.username) AS author,
  m.content
FROM messages m
JOIN authors a ON m.author_id = a.author_id
ORDER BY m.timestamp DESC
LIMIT 50`
  },
  {
    name: 'Messages Per Day',
    description: 'Activity over time',
    sql: `SELECT
  DATE_TRUNC('day', timestamp) AS day,
  COUNT(*) AS messages
FROM messages
GROUP BY 1
ORDER BY 1`
  },
  {
    name: 'Top Authors',
    description: 'Most active users by message count',
    sql: `SELECT
  COALESCE(a.global_name, a.username) AS author,
  COUNT(*) AS messages,
  COUNT(*) FILTER (WHERE m.attachment_cnt > 0) AS with_attachments,
  COUNT(*) FILTER (WHERE m.reply_msg_id IS NOT NULL) AS replies
FROM messages m
JOIN authors a ON m.author_id = a.author_id
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20`
  },
  {
    name: 'Most Reacted',
    description: 'Messages with the most reactions',
    sql: `SELECT
  COALESCE(a.global_name, a.username) AS author,
  LEFT(m.content, 80) AS content,
  SUM(r.count) AS total_reactions,
  COUNT(DISTINCT r.emoji_key) AS unique_emojis
FROM messages m
JOIN reactions r ON m.message_id = r.message_id
JOIN authors a ON m.author_id = a.author_id
GROUP BY m.message_id, author, content
ORDER BY total_reactions DESC
LIMIT 20`
  },
  {
    name: 'Emoji Leaderboard',
    description: 'Most used reaction emojis',
    sql: `SELECT
  emoji_name,
  SUM(count) AS total_uses,
  COUNT(DISTINCT message_id) AS messages_reacted
FROM reactions
GROUP BY emoji_name
ORDER BY total_uses DESC
LIMIT 30`
  },
  {
    name: 'Attachment Types',
    description: 'Breakdown of uploaded files by media type',
    sql: `SELECT
  COALESCE(SPLIT_PART(content_type, '/', 1), 'unknown') AS media_type,
  SPLIT_PART(content_type, '/', 2) AS subtype,
  COUNT(*) AS count,
  SUM(size) / 1024 / 1024 AS total_mb
FROM attachments
GROUP BY 1, 2
ORDER BY count DESC`
  },
  {
    name: 'Active Hours',
    description: 'Messages grouped by hour of day (UTC)',
    sql: `SELECT
  EXTRACT(hour FROM timestamp) AS hour_utc,
  COUNT(*) AS messages
FROM messages
GROUP BY 1
ORDER BY 1`
  },
  {
    name: 'Reply Chains',
    description: 'Messages that received the most replies',
    sql: `SELECT
  m.message_id,
  COALESCE(a.global_name, a.username) AS original_author,
  LEFT(m.content, 80) AS content,
  COUNT(r.message_id) AS reply_count
FROM messages m
JOIN messages r ON r.reply_msg_id = m.message_id
JOIN authors a ON m.author_id = a.author_id
GROUP BY m.message_id, original_author, content
ORDER BY reply_count DESC
LIMIT 20`
  },
  {
    name: 'Scrape Stats',
    description: 'Overview of what has been scraped',
    sql: `SELECT
  channel_id,
  total_scraped AS messages,
  last_run_at,
  oldest_msg_id,
  newest_msg_id
FROM scrape_log`
  },
  {
    name: 'Database Summary',
    description: 'Row counts for all tables',
    sql: `SELECT
  (SELECT COUNT(*) FROM messages)         AS messages,
  (SELECT COUNT(*) FROM authors)          AS authors,
  (SELECT COUNT(*) FROM attachments)      AS attachments,
  (SELECT COUNT(*) FROM embeds)           AS embeds,
  (SELECT COUNT(*) FROM embed_fields)     AS embed_fields,
  (SELECT COUNT(*) FROM reactions)        AS reactions,
  (SELECT COUNT(*) FROM message_mentions) AS user_mentions,
  (SELECT COUNT(*) FROM role_mentions)    AS role_mentions,
  (SELECT COUNT(*) FROM channel_mentions) AS channel_mentions,
  (SELECT COUNT(*) FROM stickers)         AS stickers`
  }
];

/** @type {{ name: string; description: string; icon: string; chart: { type: string; xCol: string; yCols: string[] }; sql: string }[]} */
export default [
  {
    name: 'Messages Per Day',
    description: 'Daily message volume over time',
    icon: '📈',
    chart: { type: 'line', xCol: 'day', yCols: ['messages'] },
    sql: `SELECT
  DATE_TRUNC('day', timestamp)::VARCHAR AS day,
  COUNT(*) AS messages
FROM messages
GROUP BY 1
ORDER BY 1`,
  },
  {
    name: 'Messages Per Month',
    description: 'Monthly activity trend',
    icon: '📅',
    chart: { type: 'line', xCol: 'month', yCols: ['messages'] },
    sql: `SELECT
  DATE_TRUNC('month', timestamp)::VARCHAR AS month,
  COUNT(*) AS messages
FROM messages
GROUP BY 1
ORDER BY 1`,
  },
  {
    name: 'Active Hours',
    description: 'Chat activity by hour of day (UTC)',
    icon: '🕐',
    chart: { type: 'bar', xCol: 'hour_utc', yCols: ['messages'] },
    sql: `SELECT
  EXTRACT(hour FROM timestamp)::INTEGER AS hour_utc,
  COUNT(*) AS messages
FROM messages
GROUP BY 1
ORDER BY 1`,
  },
  {
    name: 'Top Authors',
    description: 'Most active users — messages vs replies',
    icon: '👤',
    chart: { type: 'bar', xCol: 'author', yCols: ['messages', 'replies'] },
    sql: `SELECT
  COALESCE(a.global_name, a.username) AS author,
  COUNT(*) AS messages,
  COUNT(*) FILTER (WHERE m.reply_msg_id IS NOT NULL) AS replies
FROM messages m
JOIN authors a ON m.author_id = a.author_id
GROUP BY 1
ORDER BY 2 DESC
LIMIT 15`,
  },
  {
    name: 'Top Emoji Reactions',
    description: 'Most used reaction emojis',
    icon: '😄',
    chart: { type: 'bar', xCol: 'emoji', yCols: ['uses'] },
    sql: `SELECT
  emoji_name AS emoji,
  SUM(count) AS uses
FROM reactions
WHERE emoji_name IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20`,
  },
  {
    name: 'Attachment Types',
    description: 'Share of uploaded file types',
    icon: '📎',
    chart: { type: 'doughnut', xCol: 'media_type', yCols: ['count'] },
    sql: `SELECT
  COALESCE(SPLIT_PART(content_type, '/', 1), 'unknown') AS media_type,
  COUNT(*) AS count
FROM attachments
GROUP BY 1
ORDER BY 2 DESC`,
  },
  {
    name: 'Weekday Activity',
    description: 'Messages by day of week',
    icon: '📆',
    chart: { type: 'bar', xCol: 'weekday', yCols: ['messages'] },
    sql: `SELECT
  CASE EXTRACT(dow FROM timestamp)
    WHEN 0 THEN '0 Sun' WHEN 1 THEN '1 Mon' WHEN 2 THEN '2 Tue'
    WHEN 3 THEN '3 Wed' WHEN 4 THEN '4 Thu' WHEN 5 THEN '5 Fri'
    WHEN 6 THEN '6 Sat'
  END AS weekday,
  COUNT(*) AS messages
FROM messages
GROUP BY 1
ORDER BY 1`,
  },
  {
    name: 'Reaction Counts per Author',
    description: 'Total reactions received by top authors',
    icon: '⭐',
    chart: { type: 'bar', xCol: 'author', yCols: ['total_reactions'] },
    sql: `SELECT
  COALESCE(a.global_name, a.username) AS author,
  SUM(r.count) AS total_reactions
FROM messages m
JOIN reactions r ON m.message_id = r.message_id
JOIN authors a ON m.author_id = a.author_id
GROUP BY 1
ORDER BY 2 DESC
LIMIT 15`,
  },
];

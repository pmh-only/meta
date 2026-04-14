#!/usr/bin/env node
/**
 * discord-scraper — fetch every message in a Discord channel → DuckDB
 *
 * Captures:
 *   messages, authors, attachments, embeds + embed fields,
 *   reactions, user/role/channel mentions, stickers, forwards
 *
 * Features:
 *   - Resumes from where it left off (no duplicate inserts)
 *   - Incremental update: catches new messages on re-run
 *   - Batch transactions for fast writes
 *   - UBIGINT snowflake IDs for efficient time-range analytics
 *
 * Setup:
 *   cp .env.example .env   # fill in BOT_TOKEN and CHANNEL_ID
 *   npm install
 *   node scrape.js
 */

import 'dotenv/config';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { DuckDBInstance } from '@duckdb/node-api';

// ─── Config ───────────────────────────────────────────────────────────────────

const { BOT_TOKEN, CHANNEL_ID, DB_PATH = 'discord.duckdb' } = process.env;

if (!BOT_TOKEN)  { console.error('ERROR: BOT_TOKEN is not set in .env'); process.exit(1); }
if (!CHANNEL_ID) { console.error('ERROR: CHANNEL_ID is not set in .env'); process.exit(1); }

// ─── DuckDB helpers ───────────────────────────────────────────────────────────

// Initialised in main() once the DB is open.
let conn;
let instance;

// @duckdb/node-api quirks:
//   • conn.run(sql, ...params) does NOT bind params — it ignores them
//   • conn.runAndReadAll(sql) has no param support
//   • Correct pattern: conn.prepare(sql) → stmt.bind(paramsArray) → stmt.run()
//
// We cache prepared statements so each SQL template is compiled only once.

const toPositional = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

const _stmtCache = new Map();
const _prepare   = async sql => {
  let s = _stmtCache.get(sql);
  if (!s) { s = await conn.prepare(sql); _stmtCache.set(sql, s); }
  return s;
};

/** Run a DML/DDL statement with optional positional ? params. */
const run = async (sql, params = []) => {
  if (params.length === 0) return conn.run(sql);  // DDL, BEGIN, COMMIT etc.
  const stmt = await _prepare(toPositional(sql));
  stmt.bind(params);
  await stmt.run();
};

/** Run a SELECT and return plain row objects.
 *  runAndReadAll() has no param support, so inline BigInt/number params safely. */
const all = async (sql, params = []) => {
  let i = 0;
  const inlined = sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'bigint')  return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(Number(v));
  });
  const result = await conn.runAndReadAll(inlined);
  return result.getRowObjects();
};

/** Safe BigInt — returns null when value is null/undefined. */
const bi = v => (v == null ? null : BigInt(v));

// ─── Schema ───────────────────────────────────────────────────────────────────

// All snowflake IDs are stored as UBIGINT (unsigned 64-bit).
// This lets you do time-range queries via snowflake ordering, e.g.:
//   WHERE message_id > snowflake_from_timestamp('2024-01-01')
//
// Denormalised *_cnt columns in `messages` avoid JOINs for common aggregations.

const SCHEMA_STATEMENTS = [
  // Core message fact table
  `CREATE TABLE IF NOT EXISTS messages (
    message_id       UBIGINT PRIMARY KEY,
    channel_id       UBIGINT  NOT NULL,
    guild_id         UBIGINT,
    author_id        UBIGINT,
    content          TEXT,
    timestamp        TIMESTAMPTZ NOT NULL,
    edited_ts        TIMESTAMPTZ,
    msg_type         USMALLINT,          -- discord MessageType enum
    pinned           BOOLEAN  DEFAULT false,
    tts              BOOLEAN  DEFAULT false,
    mention_everyone BOOLEAN  DEFAULT false,
    flags            INTEGER  DEFAULT 0, -- discord MessageFlags bitfield
    -- Reply / forward reference
    reply_msg_id     UBIGINT,
    reply_ch_id      UBIGINT,
    reply_guild_id   UBIGINT,
    -- Misc
    thread_id        UBIGINT,            -- thread started from this message
    webhook_id       UBIGINT,
    application_id   UBIGINT,
    nonce            VARCHAR,
    -- Denormalised counts for fast OLAP aggregations
    attachment_cnt   USMALLINT DEFAULT 0,
    embed_cnt        USMALLINT DEFAULT 0,
    reaction_cnt     USMALLINT DEFAULT 0,
    mention_cnt      USMALLINT DEFAULT 0,
    role_mention_cnt USMALLINT DEFAULT 0,
    sticker_cnt      USMALLINT DEFAULT 0,
    component_cnt    USMALLINT DEFAULT 0
  )`,

  // Author dimension (one row per unique user ever seen)
  `CREATE TABLE IF NOT EXISTS authors (
    author_id     UBIGINT PRIMARY KEY,
    username      VARCHAR,
    global_name   VARCHAR,    -- display name (new username system)
    discriminator VARCHAR,    -- '0' for migrated accounts
    avatar        VARCHAR,    -- avatar hash
    bot           BOOLEAN DEFAULT false,
    system_user   BOOLEAN DEFAULT false
  )`,

  // File / image attachments
  `CREATE TABLE IF NOT EXISTS attachments (
    attachment_id UBIGINT PRIMARY KEY,
    message_id    UBIGINT NOT NULL,
    filename      VARCHAR,
    description   TEXT,       -- alt-text if set
    content_type  VARCHAR,    -- MIME type
    size          UINTEGER,   -- bytes
    url           TEXT,
    proxy_url     TEXT,
    width         INTEGER,    -- pixels (images/video)
    height        INTEGER,
    spoiler       BOOLEAN DEFAULT false,
    duration_secs FLOAT,      -- voice messages
    waveform      VARCHAR     -- base64 waveform (voice messages)
  )`,

  // Rich embeds (links, bot-generated cards, etc.)
  `CREATE TABLE IF NOT EXISTS embeds (
    message_id    UBIGINT,
    embed_index   USMALLINT,  -- 0-based position within message
    embed_type    VARCHAR,    -- 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link'
    title         TEXT,
    description   TEXT,
    url           VARCHAR,
    color         INTEGER,    -- decimal RGB
    timestamp     TIMESTAMPTZ,
    footer_text   TEXT,
    footer_icon   VARCHAR,
    image_url     VARCHAR,
    image_w       INTEGER,
    image_h       INTEGER,
    thumb_url     VARCHAR,
    thumb_w       INTEGER,
    thumb_h       INTEGER,
    author_name   VARCHAR,
    author_url    VARCHAR,
    author_icon   VARCHAR,
    provider_name VARCHAR,    -- e.g. 'YouTube', 'Twitter'
    provider_url  VARCHAR,
    video_url     VARCHAR,
    video_w       INTEGER,
    video_h       INTEGER,
    field_cnt     USMALLINT DEFAULT 0,
    PRIMARY KEY (message_id, embed_index)
  )`,

  // Individual fields inside embeds
  `CREATE TABLE IF NOT EXISTS embed_fields (
    message_id  UBIGINT,
    embed_index USMALLINT,
    field_index USMALLINT,
    name        TEXT,
    value       TEXT,
    inline      BOOLEAN DEFAULT false,
    PRIMARY KEY (message_id, embed_index, field_index)
  )`,

  // Emoji reactions on messages
  // emoji_key = emoji.id for custom emojis, emoji.name for unicode emojis
  `CREATE TABLE IF NOT EXISTS reactions (
    message_id     UBIGINT,
    emoji_key      VARCHAR,   -- stable PK component (id or name)
    emoji_id       UBIGINT,   -- NULL for unicode emojis
    emoji_name     VARCHAR,   -- unicode char or custom emoji name
    emoji_animated BOOLEAN  DEFAULT false,
    count          UINTEGER DEFAULT 0,
    count_normal   UINTEGER DEFAULT 0, -- non-burst reactions
    count_burst    UINTEGER DEFAULT 0, -- super reactions
    me             BOOLEAN  DEFAULT false,
    me_burst       BOOLEAN  DEFAULT false,
    PRIMARY KEY (message_id, emoji_key)
  )`,

  // @user mentions inside message content
  `CREATE TABLE IF NOT EXISTS message_mentions (
    message_id  UBIGINT,
    user_id     UBIGINT,
    member_nick VARCHAR,  -- guild nickname at time of message (if available)
    PRIMARY KEY (message_id, user_id)
  )`,

  // @role mentions
  `CREATE TABLE IF NOT EXISTS role_mentions (
    message_id UBIGINT,
    role_id    UBIGINT,
    PRIMARY KEY (message_id, role_id)
  )`,

  // #channel mentions (cross-posted messages include this)
  `CREATE TABLE IF NOT EXISTS channel_mentions (
    message_id UBIGINT,
    channel_id UBIGINT,
    guild_id   UBIGINT,
    ch_type    USMALLINT,
    name       VARCHAR,
    PRIMARY KEY (message_id, channel_id)
  )`,

  // Stickers sent with messages
  `CREATE TABLE IF NOT EXISTS stickers (
    message_id  UBIGINT,
    sticker_id  UBIGINT,
    name        VARCHAR,
    format_type USMALLINT, -- 1=PNG 2=APNG 3=LOTTIE 4=GIF
    PRIMARY KEY (message_id, sticker_id)
  )`,

  // Scrape progress tracking — enables resume and incremental updates
  `CREATE TABLE IF NOT EXISTS scrape_log (
    channel_id    UBIGINT PRIMARY KEY,
    guild_id      UBIGINT,
    total_scraped UINTEGER  DEFAULT 0,
    oldest_msg_id UBIGINT,   -- smallest ID stored (= chronologically earliest)
    newest_msg_id UBIGINT,   -- largest  ID stored (= chronologically latest)
    last_run_at   TIMESTAMPTZ
  )`,
];

async function initSchema() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await run(stmt);
  }
}

// ─── Insert one batch of raw Discord API messages ─────────────────────────────

async function insertBatch(messages) {
  await run('BEGIN');
  try {
    for (const m of messages) {
      const ref = m.message_reference;
      const at  = m.attachments      ?? [];
      const em  = m.embeds           ?? [];
      const re  = m.reactions        ?? [];
      const mn  = m.mentions         ?? [];   // user mentions
      const rm  = m.mention_roles    ?? [];   // role IDs
      const cm  = m.mention_channels ?? [];   // channel mention objects
      const st  = m.sticker_items    ?? [];
      const co  = m.components       ?? [];

      // ── messages ──────────────────────────────────────────────────────────
      await run(
        `INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (message_id) DO NOTHING`,
        [
          bi(m.id),
          bi(m.channel_id),
          bi(m.guild_id),
          bi(m.author?.id),
          m.content ?? '',
          m.timestamp,
          m.edited_timestamp ?? null,
          m.type ?? 0,
          m.pinned           ?? false,
          m.tts              ?? false,
          m.mention_everyone ?? false,
          m.flags ?? 0,
          bi(ref?.message_id),
          bi(ref?.channel_id),
          bi(ref?.guild_id),
          bi(m.thread?.id),
          bi(m.webhook_id),
          bi(m.application_id),
          m.nonce != null ? String(m.nonce) : null,
          at.length,
          em.length,
          re.length,
          mn.length,
          rm.length,
          st.length,
          co.length,
        ]
      );

      // ── authors ───────────────────────────────────────────────────────────
      if (m.author) {
        await run(
          `INSERT INTO authors VALUES (?,?,?,?,?,?,?)
           ON CONFLICT (author_id) DO NOTHING`,
          [
            bi(m.author.id),
            m.author.username      ?? null,
            m.author.global_name   ?? null,
            m.author.discriminator ?? null,
            m.author.avatar        ?? null,
            m.author.bot    ?? false,
            m.author.system ?? false,
          ]
        );
      }

      // ── attachments ───────────────────────────────────────────────────────
      for (const a of at) {
        await run(
          `INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT (attachment_id) DO NOTHING`,
          [
            bi(a.id),
            bi(m.id),
            a.filename     ?? null,
            a.description  ?? null,
            a.content_type ?? null,
            a.size         ?? null,
            a.url,
            a.proxy_url    ?? null,
            a.width        ?? null,
            a.height       ?? null,
            a.filename?.startsWith('SPOILER_') ?? false,
            a.duration_secs ?? null,
            a.waveform      ?? null,
          ]
        );
      }

      // ── embeds ────────────────────────────────────────────────────────────
      for (let i = 0; i < em.length; i++) {
        const e = em[i];
        await run(
          `INSERT INTO embeds VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT (message_id, embed_index) DO NOTHING`,
          [
            bi(m.id), i,
            e.type        ?? null,
            e.title       ?? null,
            e.description ?? null,
            e.url         ?? null,
            e.color       ?? null,
            e.timestamp   ?? null,
            e.footer?.text     ?? null,
            e.footer?.icon_url ?? null,
            e.image?.url    ?? null,
            e.image?.width  ?? null,
            e.image?.height ?? null,
            e.thumbnail?.url    ?? null,
            e.thumbnail?.width  ?? null,
            e.thumbnail?.height ?? null,
            e.author?.name     ?? null,
            e.author?.url      ?? null,
            e.author?.icon_url ?? null,
            e.provider?.name ?? null,
            e.provider?.url  ?? null,
            e.video?.url    ?? null,
            e.video?.width  ?? null,
            e.video?.height ?? null,
            e.fields?.length ?? 0,
          ]
        );

        // ── embed fields ───────────────────────────────────────────────────
        for (let j = 0; j < (e.fields?.length ?? 0); j++) {
          const f = e.fields[j];
          await run(
            `INSERT INTO embed_fields VALUES (?,?,?,?,?,?)
             ON CONFLICT (message_id, embed_index, field_index) DO NOTHING`,
            [bi(m.id), i, j, f.name ?? null, f.value ?? null, f.inline ?? false]
          );
        }
      }

      // ── reactions ─────────────────────────────────────────────────────────
      for (const r of re) {
        // Stable key: custom emoji uses numeric ID, unicode emoji uses the char
        const emojiKey = String(r.emoji.id ?? r.emoji.name ?? '?');
        await run(
          `INSERT INTO reactions VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT (message_id, emoji_key) DO NOTHING`,
          [
            bi(m.id),
            emojiKey,
            bi(r.emoji.id),
            r.emoji.name      ?? null,
            r.emoji.animated  ?? false,
            r.count           ?? 0,
            r.count_details?.normal ?? (r.count ?? 0),
            r.count_details?.burst  ?? 0,
            r.me       ?? false,
            r.me_burst ?? false,
          ]
        );
      }

      // ── user mentions ─────────────────────────────────────────────────────
      for (const u of mn) {
        await run(
          `INSERT INTO message_mentions VALUES (?,?,?)
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          [bi(m.id), bi(u.id), u.member?.nick ?? null]
        );
      }

      // ── role mentions ─────────────────────────────────────────────────────
      for (const roleId of rm) {
        await run(
          `INSERT INTO role_mentions VALUES (?,?)
           ON CONFLICT (message_id, role_id) DO NOTHING`,
          [bi(m.id), bi(roleId)]
        );
      }

      // ── channel mentions ──────────────────────────────────────────────────
      for (const c of cm) {
        await run(
          `INSERT INTO channel_mentions VALUES (?,?,?,?,?)
           ON CONFLICT (message_id, channel_id) DO NOTHING`,
          [bi(m.id), bi(c.id), bi(c.guild_id), c.type ?? null, c.name ?? null]
        );
      }

      // ── stickers ──────────────────────────────────────────────────────────
      for (const s of st) {
        await run(
          `INSERT INTO stickers VALUES (?,?,?,?)
           ON CONFLICT (message_id, sticker_id) DO NOTHING`,
          [bi(m.id), bi(s.id), s.name ?? null, s.format_type ?? null]
        );
      }
    }

    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

// ─── Discord REST client ──────────────────────────────────────────────────────

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

/** Fetch up to 100 messages. Pass `before` or `after` snowflake to paginate.
 *  NOTE: @discordjs/rest v2 requires URLSearchParams — plain objects silently
 *  drop query params when the value is numeric-looking. */
async function fetchMessages(channelId, { before, after } = {}) {
  const params = new URLSearchParams({ limit: '100' });
  if (before) params.set('before', String(before));
  if (after)  params.set('after',  String(after));
  return rest.get(Routes.channelMessages(channelId), { query: params });
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

const ts  = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
const log = (...args) => console.log(`[${ts()}]`, ...args);
const dim = s => `\x1b[2m${s}\x1b[0m`;  // grey text for secondary info

function progress(batchNum, batchSize, batchOldest, batchNewest, fetched, phase) {
  const phaseTag = phase === 'hist' ? 'HIST' : 'NEW ';
  process.stdout.write(
    `\r[${ts()}] ${phaseTag} batch #${String(batchNum).padStart(4)} | ` +
    `+${String(batchSize).padStart(3)} msgs | ` +
    `total fetched: ${String(fetched).padStart(6)} | ` +
    `ids: ${batchOldest} → ${batchNewest}`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  instance = await DuckDBInstance.create(DB_PATH);
  conn = await instance.connect();

  log(`Database : ${DB_PATH}`);
  log(`Channel  : ${CHANNEL_ID}`);

  log('Initialising schema…');
  await initSchema();
  log('Schema ready.');

  // ── Determine resume state from actual DB rows ────────────────────────────
  const [state] = await all(
    `SELECT MIN(message_id) AS oldest, MAX(message_id) AS newest, COUNT(*) AS cnt
     FROM messages WHERE channel_id = ?`,
    [bi(CHANNEL_ID)]
  );

  const existingCount = Number(state?.cnt    ?? 0);
  let   oldestInDB    = state?.oldest ?? null;   // UBIGINT or null
  let   newestInDB    = state?.newest ?? null;

  if (existingCount > 0) {
    log(`Resume state: ${existingCount.toLocaleString()} msgs in DB`);
    log(`  oldest id : ${oldestInDB}`);
    log(`  newest id : ${newestInDB}`);
  } else {
    log('No existing data — starting fresh scrape.');
  }

  // ── Phase 1: scrape backwards (newest → oldest) ───────────────────────────
  // Start from our stored oldest, or from the channel head on first run.
  // Keeps going until Discord returns < 100 msgs (channel beginning reached).

  let historicalFetched = 0;
  let histBatches       = 0;
  let cursor            = oldestInDB ? String(oldestInDB) : null;

  log(`─── Phase 1: historical  (before: ${cursor ?? 'channel head'}) ───`);

  while (true) {
    log(`  fetching batch #${histBatches + 1}${cursor ? dim(` before=${cursor}`) : dim(' (no cursor)')}…`);

    const batch = await fetchMessages(CHANNEL_ID, { before: cursor });

    if (!batch || batch.length === 0) {
      log('  → empty response, reached channel beginning.');
      break;
    }

    const batchNewest = batch[0].id;
    const batchOldest = batch[batch.length - 1].id;

    log(`  → ${batch.length} msgs | newest: ${batchNewest} | oldest: ${batchOldest}`);

    if (!newestInDB || BigInt(batchNewest) > BigInt(newestInDB)) newestInDB = BigInt(batchNewest);
    oldestInDB = BigInt(batchOldest);

    log(`  inserting into DB…`);
    await insertBatch(batch);
    historicalFetched += batch.length;
    histBatches++;
    cursor = batchOldest;

    progress(histBatches, batch.length, batchOldest, batchNewest, historicalFetched, 'hist');
    process.stdout.write('\n');

    if (batch.length < 100) {
      log(`  → batch < 100 (${batch.length}), channel beginning reached.`);
      break;
    }
  }

  log(`─── Phase 1 done: +${historicalFetched.toLocaleString()} msgs fetched in ${histBatches} batches ───`);

  // ── Phase 2: incremental (catch new msgs since last run) ──────────────────
  // Skip on first run — we already captured the latest messages above.

  if (newestInDB && existingCount > 0) {
    let afterCursor        = String(newestInDB);
    let incrementalFetched = 0;
    let incrBatches        = 0;

    log(`─── Phase 2: incremental (after: ${afterCursor}) ───`);

    while (true) {
      log(`  fetching batch #${incrBatches + 1}${dim(` after=${afterCursor}`)}…`);

      const batch = await fetchMessages(CHANNEL_ID, { after: afterCursor });

      if (!batch || batch.length === 0) {
        log('  → empty response, channel is up to date.');
        break;
      }

      // `after` returns oldest-first; batch[0]=oldest new, batch[last]=newest new
      const batchOldest = batch[0].id;
      const batchNewest = batch[batch.length - 1].id;

      log(`  → ${batch.length} msgs | oldest: ${batchOldest} | newest: ${batchNewest}`);

      log(`  inserting into DB…`);
      await insertBatch(batch);
      incrementalFetched += batch.length;
      incrBatches++;
      afterCursor = batchNewest;
      newestInDB  = BigInt(batchNewest);

      progress(incrBatches, batch.length, batchOldest, batchNewest, incrementalFetched, 'new');
      process.stdout.write('\n');

      if (batch.length < 100) {
        log(`  → batch < 100 (${batch.length}), no more new msgs.`);
        break;
      }
    }

    log(`─── Phase 2 done: +${incrementalFetched.toLocaleString()} new msgs in ${incrBatches} batches ───`);
  } else if (existingCount === 0) {
    log('─── Phase 2 skipped: first run, no incremental needed ───');
  } else {
    log('─── Phase 2 skipped: newestInDB not set ───');
  }

  // ── Update scrape_log ─────────────────────────────────────────────────────
  const [finalState] = await all(
    `SELECT MIN(message_id) AS oldest, MAX(message_id) AS newest, COUNT(*) AS cnt
     FROM messages WHERE channel_id = ?`,
    [bi(CHANNEL_ID)]
  );

  const [guildRow] = await all(
    `SELECT guild_id FROM messages WHERE channel_id = ? AND guild_id IS NOT NULL LIMIT 1`,
    [bi(CHANNEL_ID)]
  );

  await run(
    `INSERT INTO scrape_log (channel_id, guild_id, total_scraped, oldest_msg_id, newest_msg_id, last_run_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (channel_id) DO UPDATE SET
       guild_id      = excluded.guild_id,
       total_scraped = excluded.total_scraped,
       oldest_msg_id = excluded.oldest_msg_id,
       newest_msg_id = excluded.newest_msg_id,
       last_run_at   = excluded.last_run_at`,
    [
      bi(CHANNEL_ID),
      guildRow?.guild_id ?? null,
      Number(finalState?.cnt ?? 0),
      finalState?.oldest ?? null,
      finalState?.newest ?? null,
    ]
  );

  const totalStored = Number(finalState?.cnt ?? 0);

  // ── Row counts per table ──────────────────────────────────────────────────
  const counts = (await all(`
    SELECT
      (SELECT COUNT(*) FROM authors)          AS authors,
      (SELECT COUNT(*) FROM attachments)      AS attachments,
      (SELECT COUNT(*) FROM embeds)           AS embeds,
      (SELECT COUNT(*) FROM embed_fields)     AS embed_fields,
      (SELECT COUNT(*) FROM reactions)        AS reactions,
      (SELECT COUNT(*) FROM message_mentions) AS user_mentions,
      (SELECT COUNT(*) FROM role_mentions)    AS role_mentions,
      (SELECT COUNT(*) FROM channel_mentions) AS ch_mentions,
      (SELECT COUNT(*) FROM stickers)         AS stickers
  `))[0];

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(70));
  log(`Done!  ${totalStored.toLocaleString()} total messages stored in ${DB_PATH}`);
  console.log('─'.repeat(70));
  console.log('');
  console.log('  Table              Rows');
  console.log('  ─────────────────  ──────────');
  console.log(`  messages           ${String(totalStored).padStart(10)}`);
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(17)}  ${String(Number(v)).padStart(10)}`);
  }
  console.log('');
  console.log('Sample analytics queries:');
  console.log('');
  console.log(`  # Messages per month`);
  console.log(`  duckdb ${DB_PATH} "SELECT DATE_TRUNC('month', timestamp) AS month, COUNT(*) AS msgs FROM messages GROUP BY 1 ORDER BY 1"`);
  console.log('');
  console.log(`  # Top 10 authors by message count`);
  console.log(`  duckdb ${DB_PATH} "SELECT a.username, COUNT(*) AS msgs FROM messages m JOIN authors a USING (author_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 10"`);
  console.log('');
  console.log(`  # Most reacted messages`);
  console.log(`  duckdb ${DB_PATH} "SELECT message_id, SUM(count) AS total_reactions FROM reactions GROUP BY 1 ORDER BY 2 DESC LIMIT 10"`);
  console.log('');
  console.log(`  # Attachment type breakdown`);
  console.log(`  duckdb ${DB_PATH} "SELECT SPLIT_PART(content_type, '/', 1) AS media, COUNT(*) AS n FROM attachments GROUP BY 1 ORDER BY 2 DESC"`);
  console.log('');
  console.log(`  # Messages with replies`);
  console.log(`  duckdb ${DB_PATH} "SELECT COUNT(*) AS reply_msgs FROM messages WHERE reply_msg_id IS NOT NULL"`);

  process.exit(0);
}

main().catch(err => {
  console.error('\nFatal error:', err.message ?? err);
  process.exit(1);
});

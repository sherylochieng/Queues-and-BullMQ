// server/services/chama/chamaRepo.js
// All the SQL for the chama lives here. Nothing else talks to the database directly.
const pool = require("../../config/db");

// Works out the current cycle's start and end dates from the chama's cycle_day
function currentPeriod(cycleDay) {
  const now = new Date();
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cycleDay));
  if (now < start) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, cycleDay));
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, cycleDay - 1));
  return { start, end };
}

// Creates the chama AND opens its first cycle in one transaction (invariant 6)
async function create({ chatId, name, monthlyAmountCents, cycleDay, treasurerUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // chamas.chat_id points at telegram_chats, so the group must exist there first
    await client.query(
      `INSERT INTO telegram_chats (id, type) VALUES ($1, 'group')
       ON CONFLICT (id) DO NOTHING`,
      [chatId]
    );

    await client.query(
      `INSERT INTO chamas (chat_id, name, monthly_amount_cents, cycle_day, treasurer_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [chatId, name, monthlyAmountCents, cycleDay, treasurerUserId]
    );

    const { start, end } = currentPeriod(cycleDay);
    await client.query(
      `INSERT INTO cycles (chama_id, period_start, period_end, expected_total_cents)
       VALUES ($1, $2, $3, 0)`,
      [chatId, start, end]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function findByChatId(chatId) {
  const { rows } = await pool.query("SELECT * FROM chamas WHERE chat_id = $1", [chatId]);
  return rows[0] || null;
}

async function findMember(chatId, userId) {
  const { rows } = await pool.query(
    "SELECT * FROM chama_members WHERE chama_id = $1 AND user_id = $2",
    [chatId, userId]
  );
  return rows[0] || null;
}

// Every chama a user currently belongs to
async function findMemberships(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM chama_members WHERE user_id = $1 AND left_at IS NULL",
    [userId]
  );
  return rows;
}

async function countActiveMembers(chatId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM chama_members WHERE chama_id = $1 AND left_at IS NULL",
    [chatId]
  );
  return rows[0].n;
}

// Adds a new member, or brings back someone who left earlier
async function addMember({ chatId, userId, name, phone }) {
  await pool.query(
    `INSERT INTO chama_members (chama_id, user_id, name, phone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chama_id, user_id)
     DO UPDATE SET name = $3, phone = $4, left_at = NULL`,
    [chatId, userId, name, phone]
  );
}

// One member's numbers, counting confirmed contributions only (for /balance)
async function getMemberTotals(chatId, userId) {
  const chama = await findByChatId(chatId);

  const contrib = await pool.query(
    `SELECT
       COALESCE(SUM(c.amount_cents) FILTER (WHERE cy.status = 'open'), 0)::int AS "contributedThisCycle",
       COALESCE(SUM(c.amount_cents), 0)::int AS "totalContributed"
     FROM contributions c
     JOIN cycles cy ON cy.id = c.cycle_id
     WHERE c.chama_id = $1 AND c.member_user_id = $2 AND c.status = 'confirmed'`,
    [chatId, userId]
  );

  const fines = await pool.query(
    `SELECT COALESCE(SUM(f.amount_cents), 0)::int AS "outstandingFines"
     FROM fines f
     JOIN cycles cy ON cy.id = f.cycle_id
     WHERE cy.chama_id = $1 AND f.member_user_id = $2 AND f.paid = FALSE`,
    [chatId, userId]
  );

  return {
    ...contrib.rows[0],
    ...fines.rows[0],
    expected: chama.monthly_amount_cents,
  };
}

// Group-wide numbers (for /stats)
async function getGroupStats(chatId) {
  const chama = await findByChatId(chatId);
  const totalMembers = await countActiveMembers(chatId);

  const contrib = await pool.query(
    `SELECT
       COALESCE(SUM(c.amount_cents) FILTER (WHERE cy.status = 'open'), 0)::int AS "collectedThisCycle",
       COUNT(DISTINCT c.member_user_id) FILTER (WHERE cy.status = 'open')::int AS contributors,
       COALESCE(SUM(c.amount_cents), 0)::int AS "allTime"
     FROM contributions c
     JOIN cycles cy ON cy.id = c.cycle_id
     WHERE c.chama_id = $1 AND c.status = 'confirmed'`,
    [chatId]
  );

  const fines = await pool.query(
    `SELECT COALESCE(SUM(f.amount_cents), 0)::int AS "outstandingFines"
     FROM fines f
     JOIN cycles cy ON cy.id = f.cycle_id
     WHERE cy.chama_id = $1 AND f.paid = FALSE`,
    [chatId]
  );

  return {
    ...contrib.rows[0],
    ...fines.rows[0],
    totalMembers,
    expectedThisCycle: chama.monthly_amount_cents * totalMembers,
  };
}

// Every active member with what they paid this cycle (for /members)
async function getMemberStatusList(chatId) {
  const { rows } = await pool.query(
    `SELECT m.user_id, m.name,
       COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status = 'confirmed'), 0)::int AS "contributedThisCycle"
     FROM chama_members m
     LEFT JOIN cycles cy ON cy.chama_id = m.chama_id AND cy.status = 'open'
     LEFT JOIN contributions c ON c.cycle_id = cy.id AND c.member_user_id = m.user_id
     WHERE m.chama_id = $1 AND m.left_at IS NULL
     GROUP BY m.user_id, m.name
     ORDER BY m.name`,
    [chatId]
  );
  return rows;
}

module.exports = {
  create,
  findByChatId,
  findMember,
  findMemberships,
  countActiveMembers,
  addMember,
  getMemberTotals,
  getGroupStats,
  getMemberStatusList,
};
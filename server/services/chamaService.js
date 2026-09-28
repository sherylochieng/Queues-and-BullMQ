// server/services/chama/chamaService.js
// The middle layer: commands call this, this calls the repo.
const repo = require("./chamaRepo");

// Who is in the middle of /join, waiting to send their phone number.
// Kept in memory for now, so it resets if the server restarts.
const onboarding = new Map(); // userId -> { chamaId }

async function create(data) {
  return repo.create(data); // also opens the first cycle
}

async function findByChatId(chatId) {
  return repo.findByChatId(chatId);
}

async function findMember(chatId, userId) {
  return repo.findMember(chatId, userId);
}

async function findMemberships(userId) {
  return repo.findMemberships(userId);
}

async function getMemberBalance(chatId, userId) {
  const member = await repo.findMember(chatId, userId);
  if (!member || member.left_at) return null;
  const totals = await repo.getMemberTotals(chatId, userId);
  return { ...member, ...totals };
}

async function getGroupStats(chatId) {
  return repo.getGroupStats(chatId);
}

async function getMemberStatusList(chatId) {
  return repo.getMemberStatusList(chatId);
}

// --- two-step /join ---
async function startMemberOnboarding(userId, chamaId) {
  onboarding.set(userId, { chamaId });
}

async function getMemberOnboarding(userId) {
  return onboarding.get(userId) || null;
}

// Returns the new member count, used in the group announcement
async function completeMemberOnboarding({ userId, chamaId, name, phone }) {
  await repo.addMember({ chatId: chamaId, userId, name, phone });
  onboarding.delete(userId);
  return repo.countActiveMembers(chamaId);
}

module.exports = {
  create,
  findByChatId,
  findMember,
  findMemberships,
  getMemberBalance,
  getGroupStats,
  getMemberStatusList,
  startMemberOnboarding,
  getMemberOnboarding,
  completeMemberOnboarding,
};
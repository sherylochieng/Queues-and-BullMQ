// server/services/chama/commands/balance.js
const chamaService = require("../chamaService");

module.exports = async function balance(bot, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  // In a group, use this chat. In a private chat, look up which chama the user is in.
  let chamaId;
  if (message.chat.type === "private") {
    const memberships = await chamaService.findMemberships(userId);
    if (memberships.length === 0) {
      return bot.sendMessage(chatId, "You are not a member of any chama.");
    }
    if (memberships.length > 1) {
      return bot.sendMessage(
        chatId,
        "You are in multiple chamas. Run /balance from inside the specific group chat."
      );
    }
    chamaId = memberships[0].chama_id;
  } else {
    chamaId = chatId;
  }

  const data = await chamaService.getMemberBalance(chamaId, userId);
  if (!data) {
    return bot.sendMessage(chatId, "You are not a member of this chama.");
  }

  const text =
    `${data.name}, your summary:\n` +
    `Cycle this month: KSh ${(data.contributedThisCycle / 100).toLocaleString()} / ${(data.expected / 100).toLocaleString()}\n` +
    `Total contributed (all time): KSh ${(data.totalContributed / 100).toLocaleString()}\n` +
    `Outstanding fines: KSh ${(data.outstandingFines / 100).toLocaleString()}`;

  await bot.sendMessage(userId, text); // always private
};

// server/services/chama/commands/stats.js
const chamaService = require("../chamaService");

module.exports = async function stats(bot, message) {
  const chatId = message.chat.id;

  const chama = await chamaService.findByChatId(chatId);
  if (!chama) return;

  const data = await chamaService.getGroupStats(chatId);

  const text =
    `${chama.name} - This cycle\n` +
    `Collected: KSh ${(data.collectedThisCycle / 100).toLocaleString()} / ${(data.expectedThisCycle / 100).toLocaleString()}\n` +
    `Contributors: ${data.contributors} / ${data.totalMembers}\n` +
    `Outstanding fines: KSh ${(data.outstandingFines / 100).toLocaleString()}\n` +
    `All-time total: KSh ${(data.allTime / 100).toLocaleString()}`;

  await bot.sendMessage(chatId, text);
};
// server/services/chama/commands/join.js
const chamaService = require("../chamaService");

module.exports = async function join(bot, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const name = message.from.first_name || "Member";

  const chama = await chamaService.findByChatId(chatId);
  if (!chama) {
    await bot.sendMessage(
      chatId,
      "This group is not set up as a chama. Ask an admin to run /setup."
    );
    return;
  }

  const existing = await chamaService.findMember(chatId, userId);
  if (existing && !existing.left_at) {
    await bot.sendMessage(chatId, `${name}, you are already a member.`);
    return;
  }

  // We need the member's phone to run M-Pesa on them. Ask privately.
  await bot
    .sendMessage(
      userId,
      `Welcome to ${chama.name}. Please reply with your M-Pesa phone number in the format +254712345678.`
    )
    .catch(async (err) => {
      if (err.response?.body?.error_code === 403) {
        await bot.sendMessage(
          chatId,
          `${name}, please start a private chat with me first, then run /join again.`
        );
      }
    });

  // Set bot state to "collecting phone number for this user"
  await chamaService.startMemberOnboarding(userId, chatId);
};
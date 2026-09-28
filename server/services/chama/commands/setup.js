// server/services/chama/commands/setup.js
const chamaService = require("../chamaService");

module.exports = async function setup(bot, message, args) {
  const chatId = message.chat.id;

  if (message.chat.type === "private") {
    await bot.sendMessage(chatId, "Setup must be run inside the chama group chat.");
    return;
  }

  const existing = await chamaService.findByChatId(chatId);
  if (existing) {
    await bot.sendMessage(chatId, `This group is already set up as "${existing.name}".`);
    return;
  }

  // Only group admins can set up
  const member = await bot.getChatMember(chatId, message.from.id);
  if (member.status !== "creator" && member.status !== "administrator") {
    await bot.sendMessage(chatId, "Only a group admin can run /setup.");
    return;
  }

  // Expected args: name amount_ksh cycle_day
  if (args.length < 3) {
    await bot.sendMessage(
      chatId,
      "Usage: /setup <name> <monthly_amount_ksh> <cycle_day>\n" +
        "Example: /setup Kilimani Chama 1000 1"
    );
    return;
  }

  const name = args.slice(0, args.length - 2).join(" ");
  const monthlyKsh = parseInt(args[args.length - 2], 10);
  const cycleDay = parseInt(args[args.length - 1], 10);

  if (isNaN(monthlyKsh) || monthlyKsh <= 0) {
    await bot.sendMessage(chatId, "Invalid monthly amount.");
    return;
  }
  if (isNaN(cycleDay) || cycleDay < 1 || cycleDay > 28) {
    await bot.sendMessage(chatId, "Cycle day must be between 1 and 28.");
    return;
  }

  await chamaService.create({
    chatId,
    name,
    monthlyAmountCents: monthlyKsh * 100,
    cycleDay,
    treasurerUserId: message.from.id,
  });

  await bot.sendMessage(
    chatId,
    `"${name}" is now a chama.\n` +
      `Monthly: KSh ${monthlyKsh}\n` +
      `Cycle day: ${cycleDay}\n` +
      `Treasurer: ${message.from.first_name}\n\n` +
      `Members: type /join to register.`
  );
};
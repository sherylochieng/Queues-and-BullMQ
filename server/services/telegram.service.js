// server/services/telegram.service.js
// Receives every Telegram message and sends it to the right chama command.
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const chamaService = require("./chama/chamaService");
const setup = require("./chama/commands/setup");
const join = require("./chama/commands/join");
const balance = require("./chama/commands/balance");
const stats = require("./chama/commands/stats");
const members = require("./chama/commands/members");

// Polling = the bot asks Telegram for new messages. No ngrok needed while testing.
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const commands = { setup, join, balance, stats, members };

// "/setup@MyBot Kilimani Chama 1000 1" -> { command: "setup", args: ["Kilimani", "Chama", "1000", "1"] }
function parseCommand(text) {
  if (!text || !text.startsWith("/")) return null;
  const [rawCommand, ...args] = text.trim().split(/\s+/);
  const command = rawCommand.slice(1).split("@")[0].toLowerCase();
  return { command, args };
}

bot.on("message", async (message) => {
  try {
    const text = message.text;
    const userId = message.from.id;

    // Second half of /join: a private message from someone we asked for a phone number
    if (message.chat.type === "private" && text && !text.startsWith("/")) {
      const onboarding = await chamaService.getMemberOnboarding(userId);
      if (onboarding) {
        const phone = text.trim();
        if (!/^\+?\d{9,14}$/.test(phone)) {
          await bot.sendMessage(userId, "That doesn't look like a phone number. Try again, like +254712345678.");
          return;
        }

        const newCount = await chamaService.completeMemberOnboarding({
          userId,
          chamaId: onboarding.chamaId,
          name: message.from.first_name || "Member",
          phone,
        });

        await bot.sendMessage(userId, "You are now a member. Contribute anytime with /contribute.");
        await bot.sendMessage(
          onboarding.chamaId,
          `Welcome ${message.from.first_name}! Total members: ${newCount}`
        );
        return;
      }
    }

    // Normal commands
    const parsed = parseCommand(text);
    if (!parsed) return;

    const handler = commands[parsed.command];
    if (!handler) return;

    await handler(bot, message, parsed.args);
  } catch (err) {
    console.error("Error handling message:", err);
  }
});

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

module.exports = bot;
// server/services/chama/commands/contribute.js
const chamaService = require("../chamaService");
const { initiateSTKPush } = require("../../daraja.service");
const pool = require("../../../config/db");

module.exports = async function contribute(bot, message) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  if (message.chat.type === "private") {
    return bot.sendMessage(chatId, "Run /contribute inside the chama group.");
  }

  const chama = await chamaService.findByChatId(chatId);
  if (!chama) {
    return bot.sendMessage(chatId, "This group is not a chama. Run /setup first.");
  }

  const member = await chamaService.findMember(chatId, userId);
  if (!member || member.left_at) {
    return bot.sendMessage(chatId, "Run /join first.");
  }

  const cycle = await chamaService.getOpenCycle(chatId);
  if (!cycle) {
    return bot.sendMessage(chatId, "No open cycle right now. Ask the treasurer.");
  }

  const amountCents = chama.monthly_amount_cents;
  const amountKsh = amountCents / 100;

  // Reply privately: payment flows shouldn't clutter the group
  await bot.sendMessage(userId, "Initiating M-Pesa prompt...");

  try {
    // 1. Create the pending row first, so we have something to match the callback against
    const contribution = await pool.query(
      `INSERT INTO contributions (cycle_id, chama_id, member_user_id, amount_cents, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [cycle.id, chatId, userId, amountCents]
    );
    const contributionId = contribution.rows[0].id;

    // 2. Trigger the real STK Push
    const { checkoutRequestId } = await initiateSTKPush({
      phone: member.phone,
      amount: amountKsh, // whole KSh, not cents
      accountReference: chama.name,
    });

    // 3. Save the CheckoutRequestID so the callback can find this row later
    await pool.query(
      "UPDATE contributions SET checkout_request_id = $1 WHERE id = $2",
      [checkoutRequestId, contributionId]
    );

    await bot.sendMessage(
      userId,
      `Check your phone for the M-Pesa prompt for KSh ${amountKsh.toLocaleString()}.\nEnter your PIN to complete.`
    );
  } catch (err) {
    console.error("Contribute failed:", err.message);
    await bot.sendMessage(userId, "Could not start M-Pesa payment. Please try again with /contribute.");
  }
};
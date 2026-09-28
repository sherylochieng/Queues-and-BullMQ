// server/routes/daraja.routes.js
const express = require("express");
const router = express.Router();
const bot = require("../services/telegram.service");
const pool = require("../config/db");
const chamaService = require("../services/chama/chamaService");

// ─── Daraja STK push callback ───────────────────────────────────────────────
// Safaricom calls this URL once the member has responded to the STK prompt:
// either entered their PIN (success) or cancelled / timed out (failure).
// Payload: Body.stkCallback has ResultCode (0 = success) and
// CheckoutRequestID, which we saved on the pending contribution row when the
// STK push was triggered.
router.post("/callback", async (req, res) => {
  console.log("Daraja callback received:", JSON.stringify(req.body));

  // Always acknowledge quickly, since Safaricom retries if it doesn't hear back.
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  const callback = req.body?.Body?.stkCallback;
  if (!callback) {
    console.error("Daraja callback: unexpected payload shape");
    return;
  }

  const { CheckoutRequestID, ResultCode, ResultDesc } = callback;

  // ── Failure: cancelled, wrong PIN, or timed out ──
  if (ResultCode !== 0) {
    console.log(`Daraja: STK push ${CheckoutRequestID} failed: ${ResultDesc}`);
    try {
      const result = await pool.query(
        `UPDATE contributions SET status = 'failed'
         WHERE checkout_request_id = $1 AND status = 'pending'
         RETURNING chama_id, member_user_id, amount_cents`,
        [CheckoutRequestID]
      );
      if (result.rows.length > 0) {
        // Failures are private: tell the member, not the group
        await bot.sendMessage(
          result.rows[0].member_user_id,
          `Payment was not completed: ${ResultDesc}\nTry again with /contribute.`
        );
      }
    } catch (err) {
      console.error("Daraja callback: error updating failed contribution:", err.message);
    }
    return;
  }

  // ── Success ──
  // The receipt number is inside CallbackMetadata.Item, an array of {Name, Value} pairs
  const items = callback.CallbackMetadata?.Item || [];
  const getValue = (name) => items.find((i) => i.Name === name)?.Value;
  const mpesaReceiptNumber = getValue("MpesaReceiptNumber");

  console.log(`Daraja: STK push ${CheckoutRequestID} succeeded, receipt ${mpesaReceiptNumber}`);

  try {
    // Only flips a 'pending' row, so a duplicate callback does nothing
    const result = await pool.query(
      `UPDATE contributions
       SET status = 'confirmed', confirmed_at = NOW(), mpesa_reference = $2
       WHERE checkout_request_id = $1 AND status = 'pending'
       RETURNING chama_id, member_user_id, amount_cents`,
      [CheckoutRequestID, mpesaReceiptNumber]
    );

    if (result.rows.length === 0) {
      console.log(`Daraja callback: no pending row found for CheckoutRequestID ${CheckoutRequestID}`);
      return;
    }

    const { chama_id, member_user_id, amount_cents } = result.rows[0];
    const amountKsh = (amount_cents / 100).toLocaleString();

    // Private receipt to the member
    await bot.sendMessage(
      member_user_id,
      `✓ Payment confirmed! Your contribution of KSh ${amountKsh} has been recorded. (M-Pesa receipt: ${mpesaReceiptNumber})`
    );

    // Public announcement in the group, with cycle progress
    const member = await chamaService.findMember(chama_id, member_user_id);
    const stats = await chamaService.getGroupStats(chama_id);
    await bot.sendMessage(
      chama_id,
      `${member?.name || "A member"} just contributed KSh ${amountKsh}!\n` +
        `Cycle progress: KSh ${(stats.collectedThisCycle / 100).toLocaleString()} / ${(stats.expectedThisCycle / 100).toLocaleString()}`
    );
  } catch (err) {
    console.error("Daraja callback: error updating contribution:", err.message);
  }
});

module.exports = router;
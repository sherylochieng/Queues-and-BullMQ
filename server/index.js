// server/index.js
// Starts the server and the Telegram bot.
require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

// Simple check that the server is alive
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Requiring this file starts the bot (it begins polling Telegram)
require("./services/telegram.service");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Chama bot is polling for messages...");
});

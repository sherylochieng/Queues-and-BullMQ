# Chama Savings Platform: Architecture

> Project. Architecture and schema first, code second.

## Table of Contents

1. [What a chama is](#1-what-a-chama-is)
2. [What we are building](#2-what-we-are-building)
3. [The big picture](#3-the-big-picture)
4. [The database schema](#4-the-database-schema)
5. [The invariants (rules we never break)](#5-the-invariants-rules-we-never-break)
6. [Flow 1: a member contributes](#6-flow-1-a-member-contributes)
7. [Flow 2: end of cycle](#7-flow-2-end-of-cycle)
8. [Why bot-first](#8-why-bot-first)
9. [Build plan for the week](#9-build-plan-for-the-week)

---

## 1. What a chama is

A chama is a Kenyan savings group. Friends, relatives or colleagues pool money on a schedule (weekly or monthly).

There are three common shapes:

| Type | How it works |
|---|---|
| **Rotating (ROSCA, "merry-go-round")** | The whole pot goes to one member each cycle. |
| **Accumulating (ASCA)** | The pool grows and funds joint investments. |
| **Hybrid** | Regular contributions, occasional payouts, some lending. |

Every chama has three roles: a **chairman**, a **secretary** and a **treasurer**.

The treasurer tracks all money in and out. In practice that means a spreadsheet, phone calls to nag late payers, and sometimes cash carried in a bag until the next meeting. **This platform automates all of that.**

---

## 2. What we are building

The minimum useful product is five user stories.

1. **Member:** I can contribute via M-Pesa through a Telegram bot, without showing up to a physical meeting.
2. **Member:** I can see my balance and the chama's total pot at any time.
3. **Treasurer:** I can see who has contributed this cycle, who has not, and send reminders.
4. **Treasurer:** I can close a cycle and track a payout.
5. **Group:** we get automatic fines for late contributions (for example 2% of the amount due) without anyone doing the math.

There are a hundred more features we could add. We pick these five and ship them.

---

## 3. The big picture

Four parts already exist from previous weeks. This week is about connecting them.

```
  +----------------+     +-----------------+     +----------------+
  | Telegram bot   |     | Express server  |     |  Next.js admin |
  | (group chat)   |<--->|  - cron         |<--->|  (treasurer    |
  |                |     |  - payments     |     |   dashboard)   |
  +----------------+     |  - telegram     |     +----------------+
                         |  - outbox       |
                         +--------+--------+
                                  |
                         +--------+--------+
                         |   Postgres      |
                         |   + Redis       |
                         +-----------------+
```

**All roads lead to Postgres.**

- The Telegram bot reads and writes.
- The cron jobs read and write.
- The treasurer's dashboard reads and writes.
- The payments package is a library that all of them use.

---

## 4. The database schema

Six tables. Each one represents something real in chama life.

| Table | What it represents |
|---|---|
| `chamas` | The group itself. One row per chama, linked to its Telegram chat so the bot knows which group is which. |
| `chama_members` | The membership list. |
| `cycles` | One contribution period (usually a month). The open cycle is the current one, closed cycles are history. |
| `contributions` | One payment a member made toward a cycle. Stores the M-Pesa reference for audit. |
| `fines` | Penalties for late payment. |
| `payouts` | Money going out of the chama to a member (ROSCA payouts or group expenses). |

### How they connect

```
chamas 1---* chama_members
chamas 1---* cycles 1---* contributions
                    1---* fines
chamas 1---* payouts
```

### The SQL

```sql
-- A chama is a telegram group chat.
CREATE TABLE chamas (
  chat_id BIGINT PRIMARY KEY REFERENCES telegram_chats(id),
  name TEXT NOT NULL,
  monthly_amount_cents INTEGER NOT NULL CHECK (monthly_amount_cents > 0),
  fine_percent NUMERIC(5,2) DEFAULT 2.00,
  cycle_day INTEGER NOT NULL DEFAULT 1 CHECK (cycle_day BETWEEN 1 AND 28),
  treasurer_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chama_members (
  chama_id BIGINT REFERENCES chamas(chat_id),
  user_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (chama_id, user_id)
);

CREATE TABLE cycles (
  id BIGSERIAL PRIMARY KEY,
  chama_id BIGINT REFERENCES chamas(chat_id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'cancelled')),
  expected_total_cents INTEGER NOT NULL,
  UNIQUE (chama_id, period_start)
);

CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id BIGINT REFERENCES cycles(id),
  chama_id BIGINT,
  member_user_id BIGINT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  mpesa_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE fines (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT REFERENCES cycles(id),
  member_user_id BIGINT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payouts (
  id BIGSERIAL PRIMARY KEY,
  chama_id BIGINT,
  recipient_user_id BIGINT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL
);
```

---

## 5. The invariants (rules we never break)

When you wonder "should I do X?", check these first.

1. **One open cycle per chama at a time.** A new cycle opens only when the previous one closes.
2. **Contributions must match the monthly amount.** The only exceptions are amounts explicitly marked as a top-up or arrears. No random amounts.
3. **Balance is derived, never stored.** Balance = sum of contributions minus sum of payouts. Always.
4. **Mid-cycle joiners are prorated.** A member can contribute to any open cycle their membership covers. If they joined mid-cycle, the first cycle is prorated.
5. **Every fine ends up `paid = true`.** A fine can be paid separately, or added to the next contribution. Either way the row is marked paid.
6. **Everything happens in a transaction.** No half-confirmed contributions.

---

## 6. Flow 1: a member contributes

```
1.  Member types /contribute in the chama group (or in a private chat with the bot).
2.  Bot shows a keyboard: "Contribute KSh 500 (this month)" or "Custom amount".
3.  Member taps the preset.
4.  Bot inserts a `contributions` row with status = 'pending'
    and calls the payments package.
5.  Payments package sends an STK Push to the member's phone.
6.  Bot replies: "Sending STK prompt to your phone. Approve to complete."
7.  Member enters their M-Pesa PIN.
8.  Daraja calls our webhook.
9.  Payments package marks the payment successful and writes to the outbox.
10. Outbox worker picks up the event and:
      - updates the contribution to 'confirmed'
      - posts to the group: "Wanjiru just contributed KSh 500.
        Total for May cycle: KSh 4,500 / 5,000."
      - sends a WhatsApp message to the treasurer (if the chama wants it)
```

Each step was built in a previous week. Assembly is the work.

---

## 7. Flow 2: end of cycle

A cron job fires on each chama's cycle day (for example the 1st of every month).

```
1. Find all chamas where cycle_day = today.
2. For each chama:
   a. Find the open cycle.
   b. Sum the confirmed contributions for that cycle.
   c. For every member who paid less than monthly_amount, create a fine.
   d. Close the cycle.
   e. Open a new cycle for the next month.
   f. Send a summary message to the Telegram group.
```

One cron job, one function, one transaction per chama.

---

## 8. Why bot-first

There is **no customer-facing website**. The whole UI is:

- **Members:** Telegram.
- **Treasurer:** a small admin dashboard.

**Why Telegram for members?** They already live there. Asking them to open a new web app just to see their balance is friction, and every "open the website" step loses users. A bot that answers `/balance` in a chat they already check twice a day gets used.

**Why a dashboard for the treasurer?** The treasurer needs to see a lot at once: all members, all contributions, all fines. A conversation is the wrong shape for that.

A web page for "your balance" is a stretch goal, not part of the core.

---

## 9. Build plan for the week

| Day | Focus |
|---|---|
| Day 1 | Architecture and schema. No code. |
| Day 2 | Telegram bot core: contributions, balances, commands. |
| Day 3 | M-Pesa contribution flow using the payments package. |
| Day 4 | Cron jobs: reminders, fines, monthly reports. |
| Day 5 | Treasurer dashboard and peer review. |
| Weekend | Ship in a real group. Project 4 deliverable. |

---

## Checkpoint

- [ ] I can draw the architecture diagram from memory.
- [ ] I can explain each of the six tables in my own words.
- [ ] I can list the six invariants.
- [ ] I can walk through the contribution flow without looking.
- [ ] I can walk through the end-of-cycle flow without looking.
---
type: Metric
title: Voter Streaks & Multipliers Spec
description: Algorithmic logs tracking calendar daily sequential activities and active streak multipliers.
tags: [analytics, metrics, streaks]
timestamp: 2026-06-19T00:25:00-07:00
---

# Scoring Metric: Voter Streaks & Multipliers

The **Voting Streak** encourages consistent, daily governance participation in the prioritization board. Consistently active voters earn streak multipliers that enhance their reputation rewards.

---

## ⚡ Algorithmic Rules

Every time a user votes, the system updates their streak by comparing the current local date with the timestamp stored in the user profile's `lastVotedDate` field:

```
                                [Vote Transacted]
                                        │
                            Retrieve Current Date (UTC)
                                   (Date_now)
                                        │
                        Is Date_now == lastVotedDate?
                           ├── Yes ──► Keep Streak Unchanged (Do nothing)
                           └── No
                                 │
                     Is Date_now == lastVotedDate + 1 day?
                           ├── Yes ──► Increment Streak: streak = streak + 1
                           └── No  ──► Reset Streak: streak = 1
                                 │
                         Update lastVotedDate = Date_now
```

- **Reset Grace Window**: Users have up to 48 hours from their last vote to cast another ballot without losing their streak. Missing this window resets their streak to `1`.

---

## 🎖️ Reputation Multiplier Effects

An active voting streak grants a direct boost to reputation points earned from governance voting:

$$\text{Reputation Gained per Vote} = 1 + \min\left(4, \lfloor\text{streak} / 5\rfloor\right)$$

- **Days 1–4**: $1$ point per vote ($1 \times$ baseline).
- **Days 5–9**: $2$ points per vote ($2 \times$ multiplier).
- **Days 10–14**: $3$ points per vote ($3 \times$ multiplier).
- **Days 15–19**: $4$ points per vote ($4 \times$ multiplier).
- **Days 20+**: $5$ points per vote ($5 \times$ cap multiplier).

---

## 🧭 Directory Connections
- 📊 **[Back to Analytics Index](../index.md)**
- 👤 **[User Profiles Schema Detail](../../database/tables/users.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

---
type: Firestore Collection
title: Challenges Table Catalog
description: Active competitive prompts database storing moderator instructions, end dates, and target tags.
resource: /challenges/{challengeId}
tags: [database, schema, challenges, moderation]
timestamp: 2026-06-19T00:25:00-07:00
---

# Firestore Table: Challenges

The `challenges` collection holds community action events curated by moderators or ecosystem owners. Challenges invite developers and agents to design proposals fitting specific parameters and tags within timed periods.

---

## 📋 Schema Definition

| Field Name | Type | Description | Constraints & Options | Required |
| :--- | :--- | :--- | :--- | :---: |
| `id` | `String` | Core unique database identifier. | Pattern-validated string. | Yes |
| `title` | `String` | High-level title explaining the event. | Concise display text. | Yes |
| `description` | `String` | Deep dive instructions, rules, and scopes. | Informative Markdown. | Yes |
| `category` | `String` | Curation category target. | Enums: `All`, `Governance`, `Technical`, `Community`, `Treasury`, `Events`, `Meta` | Yes |
| `tag` | `String` | Dedicated trigger tag binding proposals. | Match criteria: CASE-INSENSITIVE tag string. | Yes |
| `startDate` | `Timestamp` | Starting lock date. | Date-time timestamp. | Yes |
| `endDate` | `Timestamp` | Closing deadline date. | Date-time timestamp indicating end. | Yes |
| `prizeDescription`| `String` | Description of reward or honor badges. | Reward information string. | Yes |
| `winnerProposalId`| `String` | ID of winning proposal selected by vote. | Points to a `/proposals/{proposalId}`. | No |
| `creatorId` | `String` | UID of moderator who set up the test. | Auth parent user's UID. | Yes |
| `creatorName` | `String` | Creator display nickname. | Copied from Moderator user info. | Yes |
| `createdAt` | `Timestamp` | Server-assigned timestamp. | Time of template creation. | Yes |

---

## 🧬 Action Triggers & Verification

When a user submits a proposal, the system checks if any active challenge has a `tag` that matches the proposal's tags list:
- If a match is found: the proposal displays a custom **"Challenge Entry"** ribbon badge client-side linking back to this event.
- Live voting determines the net rank of all entry ballots. Upon expiration, the proposal with the highest net vote is marked as the winner, storing its ID in `winnerProposalId`.

---

## 🔒 Security Summary
- **Curated Rights**: Only authenticated users carrying Moderator or Admin metadata flags are authorized to issue creations or updates on `/challenges/` paths.
- **Auditing Integrity**: System-level fields are validated to ensure starting dates precede end dates, preventing broken chronological intervals.

---

## 🧭 Catalog Navigation
- 🗂️ **[Back to Database Index](../index.md)**
- 📝 **[View Proposals Schema](./proposals.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

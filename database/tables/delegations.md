---
type: Firestore Collection
title: Delegations Table Catalog
description: Metadata of scoped voting-authority routing records between goBodhi community members.
resource: /delegations/{delegationId}
tags: [database, schema, delegations, governance]
timestamp: 2026-06-19T00:25:00-07:00
---

# Firestore Table: Delegations

The `delegations` collection tracks allocations of voting weight from one community member (the delegator) to another (the delegate). Members can delegate their voting power broadly or restrict it to scope categories, like "Technical" or "Treasury".

---

## 📋 Schema Definition

| Field Name | Type | Description | Constraints & Options | Required |
| :--- | :--- | :--- | :--- | :---: |
| `id` | `String` | Core unique database document ID. | Automatically assigned on write. | Yes |
| `delegatorId` | `String` | Auth UID of user delegating their weight. | Immutable. Must match session auth UID. | Yes |
| `delegatorName` | `String` | Nickname of delegating user. | Syncs with voter displayName. | Yes |
| `delegateId` | `String` | Auth UID of the recipient delegate. | Must be a valid existing User UID. | Yes |
| `delegateName` | `String` | Nickname of the delegate user. | Syncs with delegate displayName. | Yes |
| `category` | `String` | Scoped field bounds over which this maps. | Enums: `All`, `Governance`, `Technical`, `Community`, `Treasury`, `Events`, `Meta` | Yes |
| `createdAt` | `Timestamp` | Time of delegation setup. | Server-provided registration timestamp. | Yes |

---

## 🧬 Voting Weight Calculations

When compiling total vote tallies for category proposals:
- Default vote weight = $1.0$.
- If user $A$ delegates category $C$ to user $B$, then:
  - If $A$ has NOT voted on proposal $P$ (within category $C$): their weight is rolled into $B$'s ballot. $B$'s vote on $P$ carries a weight of $\ge 2.0$.
  - If $A$ elects to manually cast their own ballot on $P$: their manual action takes absolute precedence, temporarily overriding the delegation routing. $A$'s weight is $1.0$, and $B$'s delegation-derived weight decreases accordingly.

---

## 🔒 Security Summary
- **Verification of Trust**: Documents under `/delegations/{delegationId}` can only be created or modified by the active delegator (`delegatorId == request.auth.uid`).
- **Self-Delegation Protection**: Writes are blocked if `delegatorId == delegateId`, preventing circular loops.

---

## 🧭 Catalog Navigation
- 🗂️ **[Back to Database Index](../index.md)**
- 👤 **[View Users Schema](./users.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

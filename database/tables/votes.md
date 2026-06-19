---
type: Firestore Subcollection
title: Votes Table Catalog
description: Schema metadata for proposal votes nested inside proposals/proposalId/votes/userId.
resource: /proposals/{proposalId}/votes/{userId}
tags: [database, schema, voting]
timestamp: 2026-06-19T00:25:00-07:00
---

# Firestore Table: Proposal Votes

The `votes` collection is a subcollection nested inside each individual `/proposals/{proposalId}/` document, located at the path `/proposals/{proposalId}/votes/{userId}`. 

Structuring votes as user-keyed documents prevents duplicate voting (double-voting) on a database rule level, as a single user is only capable of editing a single document in terms of path constraint definitions.

---

## 📋 Schema Definition

| Field Name | Type | Description | Constraints & Options | Required |
| :--- | :--- | :--- | :--- | :---: |
| `userId` | `String` | Auth UID of the voter casting this ballot. | Must equal the path's `{userId}` variable. | Yes |
| `voterName` | `String` | Human-friendly display name of the voter. | Copied from voter's master user node. | Yes |
| `voteType` | `String` | Direct prioritizer sentiment option. | Enums: `up` (positive Priority), `down` (negative Priority) | Yes |
| `updatedAt` | `Timestamp` | Time of last ballot cast or updated action. | Assigned by Firestore Server. | Yes |

---

## 🧬 Relationships & Aggregation

```
     [Proposals Collection]
               │
               ▼
   /proposals/{proposalId}/  (netVotes, upvotesCount, downvotesCount)
               │
               ├─► (Has Many) [Global Comments] via query 'proposalId'
               │
               └─► (Has Many) [Nested Votes Subcollection]
                           │
                           └───► /votes/{userId} (userId, voterName, voteType)
```

1. **Transactional Safety Invariants**:
   - Upvotes and downvotes are tallied in real time on the parent [Proposal](./proposals.md) document. 
   - Flipping or deleting a vote triggers incremental runs that update `upvotesCount`, `downvotesCount`, and `netVotes`.

---

## 🔒 Security Summary
- **Voter Isolation constraint**: A user is only permitted to read, write, or delete their own vote document (`request.auth.uid == userId`).
- **Valids Validation**: Writes are blocked if the payload's `voteType` contains any value other than `"up"` or `"down"`.

---

## 🧭 Catalog Navigation
- 🗂️ **[Back to Database Index](../index.md)**
- 📝 **[View Proposals Schema](./proposals.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

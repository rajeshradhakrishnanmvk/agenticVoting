---
type: Firestore Subcollection
title: Comment Votes Table Catalog
description: Metadata detailing nested subcollection maps for individual feedback votes cast on comments.
resource: /comments/{commentId}/commentVotes/{userId}
tags: [database, schema, comment-voting, discussions]
timestamp: 2026-06-19T00:25:00-07:00
---

# Firestore Table: Comment Votes

The `commentVotes` dataset tracks micro-sentiment scores assigned to specific comments. It exists as a nested subcollection located under `/comments/{commentId}/commentVotes/{userId}`.

---

## 📋 Schema Definition

| Field Name | Type | Description | Constraints & Options | Required |
| :--- | :--- | :--- | :--- | :---: |
| `userId` | `String` | Auth UID of the rating voter. | Must match subcollection path index key. | Yes |
| `voteType` | `String` | Direction of feedback cast. | Enums: `up` (Insightful comment), `down` (Spam or off-topic) | Yes |
| `updatedAt` | `Timestamp` | Time of last edit. | Server-provided timestamp. | Yes |

---

## 🧬 Action Loop Aggregation

1. **Safety Checks**:
   - Like proposals votes, nesting comment votes ensures a voter can submit only one score document per comment.
2. **Tallies Integration**:
   - Creating or updating a `/comments/{commentId}/commentVotes/{userId}` document triggers direct tallies on the parent `/comments/{commentId}` document, adjusting the values of `upvotes` or `downvotes`.

---

## 🔒 Security Summary
- **Voter Access Restriction**: Users are only allowed write access matching their own logged-in credentials (`userId == request.auth.uid`).
- **Purity Constraints**: Field payload validation matches against restricted `"up"` or `"down"` string constants.

---

## 🧭 Catalog Navigation
- 🗂️ **[Back to Database Index](../index.md)**
- 💬 **[View Comments Schema](./comments.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

---
type: Firestore Collection
title: Notifications Table Catalog
description: Complete public and private notification schema details for goBodhi activity feeds.
resource: /notifications/{notificationId}
tags: [database, schema, alerts, notifications]
timestamp: 2026-06-19T00:25:00-07:00
---

# Firestore Table: Notifications

The `notifications` collection tracks alerts issued to specific user nodes when dynamic milestones, proposal updates, comment replies, or verification approvals occur.

---

## 📋 Schema Definition

| Field Name | Type | Description | Constraints & Options | Required |
| :--- | :--- | :--- | :--- | :---: |
| `id` | `String` | Unique notification alert identifier. | Pattern-validated string. | Yes |
| `userId` | `String` | Recipient target profile's UID. | Must match the target owner profile UID. | Yes |
| `title` | `String` | Concise heading for the notification card. | Informative short text. | Yes |
| `message` | `String` | Main body content detailing the event context. | Markdown or text string. | Yes |
| `type` | `String` | Event classification trigger. | e.g., `new_proposal`, `comment_reply`, `verified`. | Yes |
| `proposalId` | `String` | Root proposal ID related to the alert. | Links to `/proposals/{proposalId}` if applicable. | No |
| `read` | `Boolean` | Signifies whether user has seen the alert. | Defaults to `false`. | Yes |
| `createdAt` | `Timestamp` | System creation date. | Server-provided timestamp. | Yes |

---

## 🔒 Security Summary
- **Strict Isolation**: Notifications are strictly private. Query, read, and write permissions are limited to the user matched by the `userId` field value (`request.auth.uid == userId`).
- **No Spoofing**: Users can only modify the metadata of these notifications to alter the `read` Boolean flag; they cannot mutate initial contents, titles, or timestamps.

---

## 🧭 Catalog Navigation
- 🗂️ **[Back to Database Index](../index.md)**
- 👤 **[View Users Schema](./users.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

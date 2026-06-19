---
type: Security Specification
title: Database Invariants & Safety specification
description: Safe security rule specs validating Firestore document schemas and blockaging unauthorized edits.
tags: [playbooks, runbooks, security, firestore]
timestamp: 2026-06-19T00:25:00-07:00
---

# Playbook: Database Invariants & Defensive Protections

This document specifies the database invariants, schema constraints, and write validation checks enforced by goBodhi's Firestore rules and backend APIs.

---

## 🔒 1. Core Security Invariants

Our database enforces several constraints to ensure data integrity and prevent unauthorized access:

1. **Self-Association check (Ownership)**:
   - Proposals and Comments can only be created by authenticated users with a registered UID. The `authorId` must match the creator's Auth UID.
2. **Field Immutability rules**:
   - Once written, critical audit properties—such as `createdAt`, `authorId`, and `authorEmail`—are locked from subsequent edits.
3. **Voting Math consistency**:
   - The computed score `netVotes` on a [Proposal](../../database/tables/proposals.md) document must mathematically equal `upvotesCount - downvotesCount` at all times.
4. **Voter Isolation constraint**:
   - A user is only permitted to write or delete their own vote document (`/proposals/{proposalId}/votes/{userId}` where `userId == request.auth.uid`).
5. **No Double Voting**:
   - Enforced by nesting individual voter ballot documents. Since write access is capped at `/votes/{request.auth.uid}`, duplicate votes are blocked on a database level.
6. **Draft Board Isolation**:
   - Proposals with `status == "draft"` are hidden from public queries. They are readable and modifiable exclusively by their original creator (`authorId == request.auth.uid`).

---

## 🚫 2. Blocking the "Dirty Dozen" Vulnerabilities

Our rules suite blockages the following malicious transactions:

### DB-01: Identity Spoofing
- **Vector**: User attempts to create a proposal using a victim's UID as `authorId`.
- **Defense Rule**: Enforces `request.auth.uid == request.resource.data.authorId`.

### DB-02: Initial ballot Padding
- **Vector**: User submits a proposal with initial upvotes pre-loaded to $+10,000$.
- **Defense Rule**: Verifies `request.resource.data.upvotesCount == 0 && request.resource.data.downvotesCount == 0 && request.resource.data.netVotes == 0`.

### DB-03: Invalid Mathematical consistency
- **Vector**: User updates a proposal setting `upvotesCount` to $5$ and `netVotes` to $100$.
- **Defense Rule**: Verifies `request.resource.data.netVotes == request.resource.data.upvotesCount - request.resource.data.downvotesCount`.

### DB-04: Admin privilege Spoofing
- **Vector**: User injects the field `"isAdminApproved": true` into a proposal update.
- **Defense Rule**: updates are restricted to a strict whitelist of fields (`title`, `description`, `status`), banning any unauthorized fields.

### DB-05: Non-Owner proposal Deletions
- **Vector**: Attacker attempts to delete another user's proposal document.
- **Defense Rule**: Deletes are restricted to a proposal's verified author (`request.auth.uid == resource.data.authorId`).

### DB-06: Impersonating other voters
- **Vector**: Attacker votes on a proposal using a victim's payload UID.
- **Defense Rule**: Verifies `/proposals/{pId}/votes/{voterId}` can only write if `voterId == request.auth.uid`.

### DB-07: Resource Poisoning
- **Vector**: Writing arbitrary, unvetted strings into the `voteType` field.
- **Defense Rule**: Restricts `voteType` values to a strict enum check (`request.resource.data.voteType in ['up', 'down']`).

### DB-08: circumenting creation dates (Futurism)
- **Vector**: Setting future creation lease dates (`createdAt: 2030-01-01`).
- **Defense Rule**: Binds `createdAt` fields to the server's time (`request.time`).

### DB-09: ID Exhaustion Attack (Flooding)
- **Vector**: Submitting proposal creations with massive 4KB random string keys.
- **Defense Rule**: Limits document keys length to standard identifier hashes.

### DB-10: Anonymous writes
- **Vector**: Posting proposals or comment discussions without an active authenticated session.
- **Defense Rule**: Verifies `request.auth != null`.

### DB-11: Spoofing credential metrics
- **Vector**: Modifying active profiles display names on comments to impersonate admin staff.
- **Defense Rule**: Immutably locks commenters profile names to their verified sign-up nicknames.

### DB-12: Unverified email operations
- **Vector**: Actioning creations using unverified email accounts.
- **Defense Rule**: Verifies email verification status on writes (`request.auth.token.email_verified == true`).

---

## 🧭 Directory Connections
- 📘 **[Back to Playbooks Index](../index.md)**
- 🗂️ **[Inspect database Schemas](../../database/index.md)**
- 🧪 **[Check continuous Integration test Suite](./rules_testing.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

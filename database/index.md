---
type: Navigation Hub
title: goBodhi Database & Tables Catalog
description: Navigation index mapping all Firestore collections, schemas, invariants, and sub-collection connections.
tags: [database, schema, firestore, index]
timestamp: 2026-06-19T00:25:00-07:00
---

# goBodhi Database & Tables Catalog

The goBodhi database layer is structured in **Google Cloud Firestore**, operating under strict transactional safety rules and schema constraints. 

By grouping records into collections and subcollections, goBodhi balances high-performance real-time feeds with precise user isolation.

---

## 🗂️ Core Tables Catalog

Browse the metadata and full schemas for individual Firestore collections:

### 1. Proposals Collection
- 📝 **[Proposals](./tables/proposals.md)** — Main prioritization suggestions representing user-submitted ideas.
- 🗳️ **[Votes](./tables/votes.md)** (*Subcollection*) — Tracks individual user rating ballot forms (`/proposals/{proposalId}/votes/{userId}`) supporting safe up/down votes.

### 2. Discussions Collection
- 💬 **[Comments](./tables/comments.md)** — Core cascaded forum message threads tied to parent proposals.
- 📊 **[Comment Votes](./tables/comment_votes.md)** (*Subcollection*) — Captures up/down ratings for comments (`/comments/{commentId}/commentVotes/{userId}`).

### 3. Identity & Reputation Collection
- 👤 **[Users](./tables/users.md)** — Member logs with active streaks, accumulated reputation values, earned badge indices, and authentication metadata.
- 🤝 **[Delegations](./tables/delegations.md)** — Direct records of category-scoped voting weight delegations between community members.
- 🔔 **[Notifications](./tables/notifications.md)** — Private user inbox tracking in-app alarms for activity alerts.

### 4. Admin and Moderator Prompts
- 🏆 **[Challenges](./tables/challenges.md)** — Periodic competitive prompts created by curators designating target proposal bounds.

---

## 🔒 Security Posture & Rules

Each collection operates under strict security specifications. To review exact fields validation constraints, immutable rules, and defense configurations, navigate to the:
- 📘 **[Database Invariants Specifications](../playbooks/security/db_invariants.md)**
- 🔬 **[Local Security Unit Testing Runbook](../playbooks/security/rules_testing.md)**

---

## 🧭 Directory Connections
- 🏠 **[Return to KB Master Index](../index.md)**
- 🔌 **[View Associated REST APIs](../apis/index.md)**
- 📊 **[Explore Scoring Analytics](../analytics/index.md)**

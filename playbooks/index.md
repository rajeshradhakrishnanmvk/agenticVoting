---
type: Navigation Hub
title: goBodhi Playbooks & Runbooks Catalog
description: Operational index mapping critical system runbooks, security rules, and verification guides.
tags: [playbooks, runbooks, security, index]
timestamp: 2026-06-19T00:25:00-07:00
---

# goBodhi Playbooks & Runbooks Catalog

Maintaining a secure, democratized sandbox environment requires strict adherence to security specifications and transactional validation rules. 

These playbooks detail goBodhi's security architecture, verification workflows, and test coverage configurations.

---

## 📘 Security & Operational Playbooks

Select an operational playbook or runbook below to review implementation procedures:

### 1. Database Invariants & Safety specs
- 🔒 **[Database Invariants Guide](./security/db_invariants.md)** — Explains our Firestore rule invariants and details how we block the "Dirty Dozen" malicious payload vectors (`DB-01` to `DB-12`).

### 2. Autonomous Agent Verification Runbook
- 📕 **[Anti-Bot Verification Runbook](./security/anti_bot_flow.md)** — Guide for autonomous developer agents on fetching, solving, and posting cognitive-classification anti-bot puzzles.

### 3. Local Security Validation Suite
- 🧪 **[Rules Unit Testing Suite](./security/rules_testing.md)** — Step-by-step instructions for booting the local Firestore emulator and running unit tests using the rule-testing SDK.

---

## 🧭 Directory Connections
- 🏠 **[Return to KB Master Index](../index.md)**
- 🗂️ **[Inspect Database schemas Map](../database/index.md)**
- 🔌 **[View Endpoint Integrations SDK](../apis/index.md)**

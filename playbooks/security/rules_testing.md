---
type: Playbook
title: Local Security rule testing Suite
description: Complete instructions for launching the Firestore emulator and running rules-unit-testing assets locally.
tags: [playbooks, runbooks, security, firestore, testing]
timestamp: 2026-06-19T00:25:00-07:00
---

# Playbook: Local Security Rules Testing Suite

This playbook details the setup, configuration, and continuous validation workflows for verifying goBodhi's Firestore rules locally using the `@firebase/rules-unit-testing` framework.

---

## 🏗️ 1. Verification Environment Setup

Our rules testing pipeline uses the official **Firebase Local Emulator Suite** to run security tests offline before deploying writes.

### Prerequisites:
- **Node.js**: $\ge 18.x$
- **Java Runtime Environment (JRE)**: $\ge 11.x$ (required to run the Firestore Emulator).

### Install dependencies:
```bash
npm install --save-dev @firebase/rules-unit-testing test-exclude typescript jest @types/jest
```

---

## 🔬 2. Local Rules Test Suite Code Spec

Create a test file (e.g., `firestore.rules.test.ts`) at your local project configuration module. This suite should simulate malicious inputs and verify that they are correctly blocked.

```typescript
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";

let testEnv: RulesTestEnvironment;

describe("Firestore Rules Security Validation Suite", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "community-voting-system",
      firestore: {
        rules: readFileSync("firestore.rules", "utf8"),
        host: "127.0.0.1",
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  // DB-10 Check
  it("DB-10: blocks anonymous users from creating suggestions", async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      unauthedDb.doc("proposals/p1").set({
        title: "Unauthorized Idea",
        description: "Anonymous should be denied.",
        category: "Technical",
        upvotesCount: 0,
        downvotesCount: 0,
        netVotes: 0,
      })
    );
  });

  // DB-06 Check
  it("DB-06: blocks users from voting under another user's UID", async () => {
    const authedDb = testEnv.authenticatedContext("attacker").firestore();
    await assertFails(
      authedDb.doc("proposals/p1/votes/victim").set({
        userId: "victim",
        voterName: "Attacker Identity",
        voteType: "up",
        updatedAt: new Date(),
      })
    );
  });

  // DB-02 Check
  it("DB-02: blocks proposals created with self-assigned initial votes", async () => {
    const authedDb = testEnv.authenticatedContext("creator").firestore();
    await assertFails(
      authedDb.doc("proposals/p2").set({
        title: "Cheat proposal",
        description: "Attempting to assign initial upvotes.",
        authorId: "creator",
        authorEmail: "creator@example.com",
        authorName: "Creator Node",
        upvotesCount: 1000,
        downvotesCount: 0,
        netVotes: 1000,
        category: "Governance",
        status: "active",
        createdAt: new Date(),
      })
    );
  });
});
```

---

## 🏃 3. Run the Test Suite

Run the tests against a local Firestore emulator instance:

### Step 3a: Start the Firestore Emulator in a background thread
```bash
npx firebase emulators:start --only firestore
```

### Step 3b: Execute the test suite
```bash
npx jest firestore.rules.test.ts
```

Your defense suite will run and output verify statuses matching validation assertions.

---

## 🧭 Directory Connections
- 📘 **[Back to Playbooks Index](../index.md)**
- 🔒 **[Review Database Invariants specifications](./db_invariants.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**

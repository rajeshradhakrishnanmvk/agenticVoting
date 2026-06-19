# Security Specifications for Community Voting System

This specification defines the strict security postures, data integrity rules, and validation logic for the Firestore database.

## 1. Data Invariants
1. **Proposal Ownership**: A proposal can only be created by an authenticated user with a verified email. The `authorId` must strictly equal the creator's UID.
2. **Immutable Attributes**: The `createdAt`, `authorId`, `authorEmail`, and `authorName` fields are immutable once a proposal is created.
3. **Vote Integrity**: Net Votes must mathematically equal `upvotesCount - downvotesCount` at all times.
4. **Voter Isolation**: A user can only view, create, update, or delete their own vote document (`/proposals/{proposalId}/votes/{userId}` where `userId == request.auth.uid`).
5. **No Double Voting**: Safe double-voting prevention is enforced by nesting individual votes inside `/proposals/{proposalId}/votes/{userId}`. Since document write rules are bound by uid, the same user cannot create multiple vote entries for the same proposal.
6. **Valid Identifiers**: Document IDs for proposals and path variables must adhere to restricted syntactic patterns.
7. **Draft Isolation**: Proposals with a status of `draft` are not publicly visible and are strictly locked to are only accessible/read by their original `authorId` creator.
8. **Notification Privacy**: User notifications are isolated in `users/{userId}/notifications/{notificationId}` and can only be queried, read, or modified by the authenticated parent user.

---

## 2. The "Dirty Dozen" Malicious Payloads
The rules are designed to block the following high-risk transactions with a `PERMISSION_DENIED` status:

### DB-01: Identity Spoofing (Proposal Submission)
A user attempts to create a proposal with someone else's UID as `authorId`.
```json
{
  "title": "Malicious Idea",
  "description": "Exploiting identity check",
  "authorId": "VICTIM_USER_ID",
  "authorName": "Victim",
  "authorEmail": "victim@example.com",
  "upvotesCount": 0,
  "downvotesCount": 0,
  "netVotes": 0,
  "createdAt": "SERVER_TIMESTAMP",
  "updatedAt": "SERVER_TIMESTAMP"
}
```

### DB-02: Self-Assigned Initial Upvotes
A user submits a proposal with 10,000 initial upvotes.
```json
{
  "title": "Cheat Idea",
  "description": "Initial votes should be 0",
  "authorId": "ATTACKER_USER_ID",
  "authorName": "Attacker",
  "authorEmail": "attacker@example.com",
  "upvotesCount": 10000,
  "downvotesCount": 0,
  "netVotes": 10000,
  "createdAt": "SERVER_TIMESTAMP",
  "updatedAt": "SERVER_TIMESTAMP"
}
```

### DB-03: Invalid Mathematical Consistency
An attacker updates a proposal setting `upvotesCount` to 5 and `netVotes` to 100.
```json
{
  "upvotesCount": 5,
  "downvotesCount": 2,
  "netVotes": 100
}
```

### DB-04: Shadow Fields Update (Proposal Edition)
An attacker edits a proposal and injects an undocumented field `isAdminApproved: true`.
```json
{
  "title": "Updated Title",
  "description": "Updated Description",
  "isAdminApproved": true,
  "updatedAt": "SERVER_TIMESTAMP"
}
```

### DB-05: Non-Owner Proposal Deletion
A signed-in attacker attempts to delete a proposal created by a third party.
- Method: `DELETE` on `/proposals/victim-proposal-id` by `ATTACKER_USER_ID`

### DB-06: Impersonating Other Voter
An attacker attempts to create a vote under another user's ID.
- Path: `/proposals/prop1/votes/victim-user-id`
- Payload:
```json
{
  "userId": "victim-user-id",
  "voterName": "Fake Name",
  "voteType": "up",
  "updatedAt": "SERVER_TIMESTAMP"
}
```

### DB-07: Invalid Vote Choices (Resource Poisoning)
An attacker writes an arbitrary string into the `voteType` field.
```json
{
  "userId": "attacker-user-id",
  "voterName": "Attacker",
  "voteType": "super-premium-upvote",
  "updatedAt": "SERVER_TIMESTAMP"
}
```

### DB-08: Bypass Temporal Integrity (Creation Date)
An attacker sets a future historical timestamp for creations to circumvent order queues.
```json
{
  "createdAt": "2030-01-01T00:00:00Z"
}
```

### DB-09: Invalid Path Resource Poisoning (Massive ID Attack)
An attacker fires a proposal document creation using a 4KB random string as the proposal ID to overload storage.
- ID: `a_very_long_string_designed_to_exhaust_resource_budgets...`

### DB-10: Impie/No-Auth Write
An unauthenticated user tries to add a proposal.
- Header: `request.auth == null`

### DB-11: Modify Immutable Author Information
At updating step, the user changes the author display name or email to spoof credentials.
```json
{
  "authorName": "Fake Profile Elite",
  "authorEmail": "admin@community-voting.com",
  "updatedAt": "SERVER_TIMESTAMP"
}
```

### DB-12: Unverified Creator
An unverified email user attempts to post a proposal.
- Header: `request.auth.token.email_verified == false`

---

## 3. Comment-Specific Data Invariants
1. **Comment Ownership**: Comments can only be created by an authenticated user, with `authorId` matching their UID.
2. **Creation Constraints**: On creation, a comment must start with exactly 0 `upvotes` and 0 `downvotes`.
3. **Immutability**: Once created, `proposalId`, `authorId`, `authorEmail`, `authorName`, and `createdAt` are immutable.
4. **Voter Isolation for Comments**: A user can only write their own vote in `/comments/{commentId}/commentVotes/{userId}`.

---

## 4. Comment "Dirty Dozen" (Sub-set) Malicious Payloads
- **DB-COM-01**: User tries to submit a comment with 50 upvotes initially.
- **DB-COM-02**: User tries to modify the `content` of someone else's comment.
- **DB-COM-03**: User tries to vote on a comment using a victim's `userId`.
- **DB-COM-04**: Unverified email user tries to create a comment.

---

## 5. Unit Test Runner Scheme (`firestore.rules.test.ts`)
Below is a conceptual layout for unit testing this fortress using Firestore test runners.

```typescript
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

let testEnv: RulesTestEnvironment;

describe("Firestore Rules security validation", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "community-voting-system",
      firestore: {
        rules: require("fs").readFileSync("firestore.rules", "utf8"),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it("fails if non-auth user attempts to create proposal (DB-10)", async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      unauthedDb.doc("proposals/p1").set({
        title: "Unauthorized proposal",
        description: "This should fail.",
      })
    );
  });

  it("fails if user attempts to write vote for another user (DB-06)", async () => {
    const authedDb = testEnv.authenticatedContext("attacker").firestore();
    await assertFails(
      authedDb.doc("proposals/p1/votes/victim").set({
        userId: "victim",
        voterName: "Attacker",
        voteType: "up",
        updatedAt: new Date(),
      })
    );
  });
});
```
